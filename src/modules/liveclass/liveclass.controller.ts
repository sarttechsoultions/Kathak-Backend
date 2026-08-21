import { LiveClassStatus, Role } from "@prisma/client";
import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { getIO } from "../../lib/socket";
import { agoraKeyReady, buildAgoraToken, numericUidFromString } from "./agoraToken";

const serialise = (liveClass: any) => ({
  ...liveClass,
  batchName: liveClass.batch?.name,
  batchCode: liveClass.batch?.code,
  courseName: liveClass.batch?.courseName,
});

const broadcastClass = (liveClass: any) => {
  try {
    getIO().emit("liveclass:class-updated", serialise(liveClass));
  } catch (err) {
    console.error("liveclass broadcast failed:", err);
  }
};

const batchSelect = { name: true, code: true, courseName: true, teacherId: true } as const;

export const listAdminLiveClasses = async (_req: Request, res: Response) => {
  const classes = await prisma.liveClass.findMany({
    include: { batch: { select: batchSelect } },
    orderBy: { scheduledStart: "asc" },
  });
  res.json({ status: "success", data: { classes: classes.map(serialise) } });
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
      classes: classes.map(serialise),
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
  const roomName = `kathak-${batch.code.toLowerCase().replace(/[^a-z0-9]/g, "")}-${Date.now().toString(36)}`;
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
    const teachesBatch = existing.batch.teacherId === user.id;
    if (!teachesBatch) {
      res.status(403).json({ status: "error", message: "You can only start or end classes for your own batches." });
      return;
    }
  }

  const liveClass = await prisma.liveClass.update({
    where: { id },
    data: { status },
    include: { batch: { select: batchSelect } },
  });
  broadcastClass(liveClass);
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

  if (isTeacher && liveClass.batch.teacherId && liveClass.batch.teacherId !== user.id) {
    res.status(403).json({ status: "error", message: "You are not assigned to this class." });
    return;
  }

  // Teacher/admin joining a scheduled class starts it so students can enter.
  if ((isTeacher || isAdmin) && liveClass.status === "SCHEDULED") {
    liveClass = await prisma.liveClass.update({
      where: { id: liveClass.id },
      data: { status: "LIVE" },
      include: { batch: true },
    });
    broadcastClass(liveClass);
  }

  if (liveClass.status === "SCHEDULED" && !isTeacher && !isAdmin) {
    res.status(403).json({ status: "error", message: "The class has not started yet. Wait for your teacher to go live." });
    return;
  }

  const agoraClientRole: "publisher" | "subscriber" = "publisher";
  const uid = numericUidFromString(user.id);
  const token = buildAgoraToken(liveClass.roomName, uid, agoraClientRole);

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
  const upcomingCount = classes.filter((c) => c.status === "SCHEDULED" || c.status === "LIVE").length;

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
      classes: classes.map(serialise),
      stats: { completedCount, upcomingCount, overallAttendance },
    },
  });
};
