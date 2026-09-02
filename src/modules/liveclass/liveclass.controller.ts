import { LiveClassStatus, Role } from "@prisma/client";
import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import {
  formatClassSlotTitle,
  formatMonthYearLabel,
  generateMonthlyClassSlots,
} from "../../lib/classScheduleGenerator";
import { parseLiveClassReminderPrefs } from "../../lib/liveClassReminders";
import {
  canTeacherJoinClass,
  isTeacherUpcomingVisible,
  minutesUntilTeacherCanJoin,
  TEACHER_EARLY_JOIN_MINUTES,
} from "../../lib/liveClassAccess";
import { getIO } from "../../lib/socket";
import { teacherOwnsBatch } from "../../lib/teacherBatchAccess";
import { createNotification } from "../notification/notification.controller";
import { agoraKeyReady, buildAgoraToken, numericUidFromString } from "./agoraToken";

const serialise = (liveClass: any, extras?: Record<string, unknown>) => ({
  ...liveClass,
  batchName: liveClass.batch?.name,
  batchCode: liveClass.batch?.code,
  courseName: liveClass.batch?.courseName,
  ...extras,
});

const serialiseForTeacher = (liveClass: any) => {
  const now = new Date();
  const payload = {
    scheduledStart: liveClass.scheduledStart,
    scheduledEnd: liveClass.scheduledEnd,
    status: liveClass.status,
  };
  return serialise(liveClass, {
    teacherVisible: isTeacherUpcomingVisible(payload, now),
    teacherCanJoin: canTeacherJoinClass(payload, now),
    minutesUntilJoin: minutesUntilTeacherCanJoin(payload, now),
  });
};

const broadcastClass = (liveClass: any) => {
  try {
    getIO().emit("liveclass:class-updated", serialise(liveClass));
  } catch (err) {
    console.error("liveclass broadcast failed:", err);
  }
};

const batchSelect = { name: true, code: true, courseName: true, teacherId: true, teacherName: true, schedule: true } as const;

const notifyBatchStudents = async (
  batchId: string,
  opts: { type: string; title: string; message: string; link?: string }
) => {
  const memberships = await prisma.batchStudent.findMany({
    where: { batchId },
    select: {
      studentId: true,
      student: { select: { notificationPrefs: true } },
    },
  });

  await Promise.all(
    memberships.map(async (row) => {
      const prefs = parseLiveClassReminderPrefs(row.student.notificationPrefs);
      if (!prefs.liveClassReminders) return;
      await createNotification(row.studentId, opts.type, opts.title, opts.message, opts.link);
    })
  );
};

const buildRoomName = (batchCode: string) =>
  `kathak-${batchCode.toLowerCase().replace(/[^a-z0-9]/g, "")}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const listAdminLiveClasses = async (_req: Request, res: Response) => {
  const classes = await prisma.liveClass.findMany({
    include: { batch: { select: batchSelect } },
    orderBy: { scheduledStart: "asc" },
  });
  res.json({ status: "success", data: { classes: classes.map((c) => serialise(c)) } });
};

export const listStudentLiveClasses = async (req: Request, res: Response) => {
  const studentId = req.user!.id;
  const studentBatches = await prisma.batchStudent.findMany({
    where: { studentId },
    select: { batchId: true },
  });
  const batchIds = studentBatches.map((b) => b.batchId);

  if (batchIds.length === 0) {
    res.json({
      status: "success",
      data: {
        classes: [],
        stats: { completedCount: 0, upcomingCount: 0, overallAttendance: null },
      },
    });
    return;
  }

  const classes = await prisma.liveClass.findMany({
    where: { batchId: { in: batchIds } },
    include: { batch: { select: batchSelect } },
    orderBy: { scheduledStart: "asc" },
  });

  const completedCount = classes.filter((c) => c.status === "COMPLETED").length;
  const upcomingCount = classes.filter((c) => c.status === "SCHEDULED" || c.status === "LIVE").length;

  let overallAttendance: string | null = null;
  const [totalAttendance, presentAttendance] = await Promise.all([
    prisma.attendance.count({ where: { studentId, batchId: { in: batchIds } } }),
    prisma.attendance.count({ where: { studentId, batchId: { in: batchIds }, status: "PRESENT" } }),
  ]);
  if (totalAttendance > 0) {
    overallAttendance = `${Math.round((presentAttendance / totalAttendance) * 100)}%`;
  }

  res.json({
    status: "success",
    data: {
      classes: classes.map((c) => serialise(c)),
      stats: { completedCount, upcomingCount, overallAttendance },
    },
  });
};

export const createLiveClass = async (req: Request, res: Response) => {
  const { batchId, title, teacherName, scheduledStart, scheduledEnd } = req.body;
  if (!batchId || !title || !teacherName || !scheduledStart || !scheduledEnd) {
    res.status(400).json({ status: "error", message: "Batch, title, teacher and class timings are required." });
    return;
  }
  const start = new Date(scheduledStart);
  const end = new Date(scheduledEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    res.status(400).json({ status: "error", message: "Class end time must be after start time." });
    return;
  }
  const batch = await prisma.batch.findUnique({ where: { id: batchId } });
  if (!batch || batch.status !== "Active") {
    res.status(400).json({ status: "error", message: "A live class can be created only for an active batch." });
    return;
  }
  const roomName = buildRoomName(batch.code);
  const liveClass = await prisma.liveClass.create({
    data: {
      batchId,
      title: String(title).trim(),
      teacherName: String(teacherName).trim(),
      scheduledStart: start,
      scheduledEnd: end,
      roomName,
    },
    include: { batch: { select: batchSelect } },
  });
  broadcastClass(liveClass);
  try {
    getIO().emit("liveclass:class-created", serialise(liveClass));
  } catch {}
  res.status(201).json({ status: "success", data: serialise(liveClass) });
};

export const setLiveClassStatus = async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const status = req.body.status as LiveClassStatus;
  if (!["LIVE", "COMPLETED", "CANCELLED"].includes(status)) {
    res.status(400).json({ status: "error", message: "Invalid live class status." });
    return;
  }

  const existing = await prisma.liveClass.findUnique({
    where: { id },
    include: { batch: { select: batchSelect } },
  });
  if (!existing) {
    res.status(404).json({ status: "error", message: "Live class not found." });
    return;
  }

  const user = req.user!;
  if (user.role === Role.TEACHER) {
    if (!existing.batch.teacherId) {
      res.status(403).json({
        status: "error",
        message: "This batch has no assigned teacher. Only admin can manage this class.",
      });
      return;
    }
    const teachesBatch = existing.batch.teacherId === user.id;
    if (!teachesBatch) {
      res.status(403).json({ status: "error", message: "You can only start or end classes for your own batches." });
      return;
    }
    if (status === "LIVE" && existing.status === "SCHEDULED" && !canTeacherJoinClass(existing)) {
      res.status(403).json({
        status: "error",
        message: `You can start this class ${TEACHER_EARLY_JOIN_MINUTES} minutes before the scheduled time.`,
      });
      return;
    }
  }

  const liveClass = await prisma.liveClass.update({
    where: { id },
    data: { status },
    include: { batch: { select: batchSelect } },
  });
  broadcastClass(liveClass);

  if (status === "CANCELLED") {
    await notifyBatchStudents(existing.batchId, {
      type: "LIVE_CLASS_CANCELLED",
      title: "Class Cancelled",
      message: `"${existing.title}" scheduled for ${existing.scheduledStart.toLocaleDateString("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "Asia/Kolkata",
      })} has been cancelled.`,
      link: "/student/classes",
    });
  }

  res.json({ status: "success", data: serialise(liveClass) });
};

export const generateMonthLiveClasses = async (req: Request, res: Response) => {
  const { batchId, year, month, durationMinutes, titlePrefix, skipExisting = true } = req.body;
  const monthsToGenerate = Math.min(
    12,
    Math.max(1, parseInt(String(req.body.months || 1), 10) || 1)
  );

  if (!batchId || !year || !month) {
    res.status(400).json({ status: "error", message: "Batch, year, and starting month are required." });
    return;
  }

  const targetYear = parseInt(String(year), 10);
  const targetMonth = parseInt(String(month), 10);
  if (
    Number.isNaN(targetYear) ||
    Number.isNaN(targetMonth) ||
    targetMonth < 1 ||
    targetMonth > 12
  ) {
    res.status(400).json({ status: "error", message: "Invalid year or month." });
    return;
  }

  const duration = Math.max(15, parseInt(String(durationMinutes || 60), 10) || 60);

  const batch = await prisma.batch.findUnique({ where: { id: String(batchId) } });
  if (!batch || batch.status !== "Active") {
    res.status(400).json({ status: "error", message: "Select an active batch with a timetable." });
    return;
  }

  if (!batch.schedule || batch.schedule === "Not Scheduled") {
    res.status(400).json({
      status: "error",
      message: "This batch has no weekly timetable. Edit the batch and set class days & time first.",
    });
    return;
  }
  const scheduleRaw = batch.schedule;

  const slots = Array.from({ length: monthsToGenerate }, (_, offset) => {
    const date = new Date(targetYear, targetMonth - 1 + offset, 1);
    return generateMonthlyClassSlots({
      scheduleRaw,
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      durationMinutes: duration,
      skipPast: true,
    });
  }).flat();

  if (slots.length === 0) {
    res.status(400).json({
      status: "error",
      message: "No class slots found for this month. Check batch days, time, and date range.",
    });
    return;
  }

  const teacherName =
    batch.teacherName && batch.teacherName !== "Unassigned"
      ? batch.teacherName
      : String(req.body.teacherName || "Faculty Instructor").trim();

  const created: ReturnType<typeof serialise>[] = [];
  let skipped = 0;

  for (const slot of slots) {
    if (skipExisting) {
      const windowStart = new Date(slot.scheduledStart.getTime() - 30 * 60 * 1000);
      const windowEnd = new Date(slot.scheduledStart.getTime() + 30 * 60 * 1000);
      const existing = await prisma.liveClass.findFirst({
        where: {
          batchId: batch.id,
          status: { not: "CANCELLED" },
          scheduledStart: { gte: windowStart, lte: windowEnd },
        },
      });
      if (existing) {
        skipped += 1;
        continue;
      }
    }

    const title =
      String(titlePrefix || "").trim() ||
      formatClassSlotTitle(batch.name, batch.courseName, slot.scheduledStart);

    const liveClass = await prisma.liveClass.create({
      data: {
        batchId: batch.id,
        title,
        teacherName,
        scheduledStart: slot.scheduledStart,
        scheduledEnd: slot.scheduledEnd,
        roomName: buildRoomName(batch.code),
      },
      include: { batch: { select: batchSelect } },
    });

    created.push(serialise(liveClass));
    broadcastClass(liveClass);
  }

  if (created.length > 0) {
    const monthLabel = formatMonthYearLabel(targetYear, targetMonth);
    await notifyBatchStudents(batch.id, {
      type: "LIVE_CLASS_SCHEDULE",
      title: "Live Class Schedule Updated",
      message: `${created.length} live class${created.length === 1 ? "" : "es"} scheduled for ${batch.name} in ${monthsToGenerate === 1 ? monthLabel : `${monthsToGenerate} months`}.`,
      link: "/student/classes",
    });
  }

  res.status(201).json({
    status: "success",
    message: `Created ${created.length} class${created.length === 1 ? "" : "es"}${skipped ? `, skipped ${skipped} existing` : ""}.`,
    data: { created: created.length, skipped, classes: created },
  });
};

export const rescheduleLiveClass = async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { scheduledStart, scheduledEnd, durationMinutes, notifyStudents = true } = req.body;

  if (!scheduledStart) {
    res.status(400).json({ status: "error", message: "New date and time are required." });
    return;
  }

  const start = new Date(scheduledStart);
  if (Number.isNaN(start.getTime())) {
    res.status(400).json({ status: "error", message: "Invalid start time." });
    return;
  }

  const existing = await prisma.liveClass.findUnique({
    where: { id },
    include: { batch: { select: batchSelect } },
  });

  if (!existing) {
    res.status(404).json({ status: "error", message: "Live class not found." });
    return;
  }

  if (existing.status === "COMPLETED" || existing.status === "CANCELLED") {
    res.status(400).json({ status: "error", message: "Cannot reschedule a completed or cancelled class." });
    return;
  }

  let end: Date;
  if (scheduledEnd) {
    end = new Date(scheduledEnd);
  } else if (durationMinutes) {
    end = new Date(start.getTime() + Math.max(15, parseInt(String(durationMinutes), 10) || 60) * 60 * 1000);
  } else {
    const previousDuration = existing.scheduledEnd.getTime() - existing.scheduledStart.getTime();
    end = new Date(start.getTime() + Math.max(15 * 60 * 1000, previousDuration));
  }

  if (Number.isNaN(end.getTime()) || end <= start) {
    res.status(400).json({ status: "error", message: "Class end time must be after start time." });
    return;
  }

  const liveClass = await prisma.liveClass.update({
    where: { id },
    data: {
      scheduledStart: start,
      scheduledEnd: end,
      status: existing.status === "LIVE" ? "SCHEDULED" : existing.status,
    },
    include: { batch: { select: batchSelect } },
  });

  broadcastClass(liveClass);

  if (notifyStudents) {
    const newDateStr = start.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "Asia/Kolkata",
    });
    const newTimeStr = start.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    });

    await notifyBatchStudents(existing.batchId, {
      type: "LIVE_CLASS_RESCHEDULED",
      title: "Class Rescheduled",
      message: `"${existing.title}" has been moved to ${newDateStr} at ${newTimeStr}.`,
      link: "/student/classes",
    });
  }

  res.json({ status: "success", data: serialise(liveClass) });
};

export const getLiveClassToken = async (req: Request, res: Response) => {
  if (!agoraKeyReady()) {
    res.status(503).json({
      status: "error",
      message: "Video service is not configured. Add AGORA_APP_ID and AGORA_APP_CERTIFICATE to backend/.env.",
    });
    return;
  }

  if (!process.env.AGORA_APP_ID) {
    res.status(503).json({ status: "error", message: "AGORA_APP_ID is missing on the server. Video cannot start." });
    return;
  }

  let liveClass = await prisma.liveClass.findUnique({
    where: { id: String(req.params.id) },
    include: { batch: true },
  });

  if (!liveClass || (liveClass.status !== "LIVE" && liveClass.status !== "SCHEDULED")) {
    res.status(404).json({ status: "error", message: "This class is not available to join." });
    return;
  }

  const user = req.user!;
  const isAdmin = user.role === Role.ADMIN;
  const isTeacher = user.role === Role.TEACHER;
  const now = new Date();

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, fullName: true, email: true },
  });
  const displayName = dbUser?.fullName?.trim() || user.fullName?.trim() || user.email || "User";

  if (liveClass.status === "SCHEDULED" && now > liveClass.scheduledEnd) {
    const updated = await prisma.liveClass.update({
      where: { id: liveClass.id },
      data: { status: "COMPLETED" },
      include: { batch: { select: batchSelect } },
    });
    broadcastClass(updated);
    res.status(410).json({ status: "error", message: "This class has ended." });
    return;
  }

  if (liveClass.status === "LIVE" && now > liveClass.scheduledEnd && !isTeacher && !isAdmin) {
    res.status(410).json({ status: "error", message: "This class has ended." });
    return;
  }

  if (!isAdmin && !isTeacher) {
    const membership = await prisma.batchStudent.findFirst({
      where: { studentId: user.id, batchId: liveClass.batchId },
      select: { id: true },
    });
    if (!membership) {
      res.status(403).json({ status: "error", message: "You are not enrolled in this class batch." });
      return;
    }
  }

  if (isTeacher) {
    const allowed = await teacherOwnsBatch(user.id, liveClass.batch, user.role);
    if (!allowed) {
      res.status(403).json({ status: "error", message: "You are not assigned to this class." });
      return;
    }
  }

  if (isTeacher && liveClass.status === "SCHEDULED") {
    const joinWindowStart = new Date(
      liveClass.scheduledStart.getTime() - TEACHER_EARLY_JOIN_MINUTES * 60 * 1000
    );
    if (now < joinWindowStart) {
      res.status(403).json({
        status: "error",
        message: `You can join this class ${TEACHER_EARLY_JOIN_MINUTES} minutes before the scheduled time.`,
      });
      return;
    }
  }

  // A class becomes live at its scheduled start, even if the teacher
  // has not joined yet, so enrolled students can enter on time.
  if (liveClass.status === "SCHEDULED" && now >= liveClass.scheduledStart) {
    liveClass = await prisma.liveClass.update({
      where: { id: liveClass.id },
      data: { status: "LIVE" },
      include: { batch: true },
    });
    broadcastClass(liveClass);
  }

  if (liveClass.status === "SCHEDULED" && !isTeacher && !isAdmin) {
    res.status(403).json({ status: "error", message: "The class has not started yet." });
    return;
  }

  const agoraClientRole: "publisher" | "subscriber" = "publisher";
  const uid = numericUidFromString(user.id);
  const token = buildAgoraToken(liveClass.roomName, uid, agoraClientRole);

  if (!token) {
    res.status(503).json({
      status: "error",
      message: "Could not generate a secure video token. Verify AGORA_APP_CERTIFICATE on the server.",
    });
    return;
  }

  if (!isAdmin && !isTeacher) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingAttendance = await prisma.attendance.findFirst({
      where: {
        studentId: user.id,
        batchId: liveClass.batchId,
        date: { gte: today },
        session: liveClass.title,
      },
    });

    if (!existingAttendance) {
      const startDiffMinutes = (now.getTime() - liveClass.scheduledStart.getTime()) / (1000 * 60);
      await prisma.attendance.create({
        data: {
          studentId: user.id,
          studentName: displayName,
          batchId: liveClass.batchId,
          batchName: liveClass.batch.name,
          session: liveClass.title,
          status: startDiffMinutes > 15 ? "LATE" : "PRESENT",
          date: new Date(),
          remarks: `Auto-marked: Joined live class.`,
        },
      });
    }
  }

  res.json({
    status: "success",
    data: {
      token,
      appId: process.env.AGORA_APP_ID,
      channelName: liveClass.roomName,
      uid,
      userId: user.id,
      userName: displayName,
      isMainSpeaker: isTeacher || isAdmin,
      role: isAdmin ? "admin" : isTeacher ? "teacher" : "student",
      agoraRole: agoraClientRole,
      liveClass: serialise(liveClass),
    },
  });
};

export const listTeacherLiveClasses = async (req: Request, res: Response) => {
  const teacherId = req.user!.id;

  const teacherBatches = await prisma.batch.findMany({
    where: { teacherId },
    select: { id: true },
  });
  const batchIds = teacherBatches.map((b) => b.id);

  if (batchIds.length === 0) {
    res.json({
      status: "success",
      data: {
        classes: [],
        stats: { completedCount: 0, upcomingCount: 0, overallAttendance: null },
      },
    });
    return;
  }

  const classes = await prisma.liveClass.findMany({
    where: { batchId: { in: batchIds } },
    include: { batch: { select: batchSelect } },
    orderBy: { scheduledStart: "asc" },
  });

  const completedCount = classes.filter((c) => c.status === "COMPLETED").length;
  const upcomingCount = classes.filter(
    (c) => (c.status === "SCHEDULED" || c.status === "LIVE") && new Date(c.scheduledEnd) >= new Date()
  ).length;

  let overallAttendance: string | null = null;
  const [totalAttendance, presentAttendance] = await Promise.all([
    prisma.attendance.count({ where: { batchId: { in: batchIds } } }),
    prisma.attendance.count({ where: { batchId: { in: batchIds }, status: "PRESENT" } }),
  ]);
  if (totalAttendance > 0) {
    overallAttendance = `${Math.round((presentAttendance / totalAttendance) * 100)}%`;
  }

  res.json({
    status: "success",
    data: {
      classes: classes.map(serialiseForTeacher),
      stats: { completedCount, upcomingCount, overallAttendance },
    },
  });
};
