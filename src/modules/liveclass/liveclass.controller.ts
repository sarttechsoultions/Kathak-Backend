import { LiveClassStatus, Role } from "@prisma/client";
import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import crypto from "crypto";
import { getIO } from "../../lib/socket";
import { agoraKeyReady, buildAgoraToken, numericUidFromString } from "./agoraToken";

const serialise = (liveClass: any) => ({ ...liveClass, batchName: liveClass.batch.name, batchCode: liveClass.batch.code, courseName: liveClass.batch.courseName });

export const listAdminLiveClasses = async (_req: Request, res: Response) => {
  const classes = await prisma.liveClass.findMany({ include: { batch: { select: { name: true, code: true, courseName: true } } }, orderBy: { scheduledStart: "asc" } });
  res.json({ status: "success", data: { classes: classes.map(serialise) } });
};

export const listStudentLiveClasses = async (req: Request, res: Response) => {
  const studentId = req.user!.id;
  const studentBatches = await prisma.batchStudent.findMany({
    where: { studentId },
    select: { batchId: true }
  });
  const batchIds = studentBatches.map((b) => b.batchId);

  const classes = await prisma.liveClass.findMany({
    where: {
      ...(batchIds.length > 0 ? { batchId: { in: batchIds } } : {})
    },
    include: { batch: { select: { name: true, code: true, courseName: true } } },
    orderBy: { scheduledStart: "asc" }
  });

  const completedCount = classes.filter(c => c.status === "COMPLETED").length;
  const upcomingCount = classes.filter(c => c.status === "SCHEDULED" || c.status === "LIVE").length;

  let overallAttendance: string | null = null;
  if (batchIds.length > 0) {
    const [totalAttendance, presentAttendance] = await Promise.all([
      prisma.attendance.count({ where: { studentId, batchId: { in: batchIds } } }),
      prisma.attendance.count({ where: { studentId, batchId: { in: batchIds }, status: "PRESENT" } }),
    ]);
    if (totalAttendance > 0) {
      overallAttendance = `${Math.round((presentAttendance / totalAttendance) * 100)}%`;
    }
  }

  res.json({ 
    status: "success", 
    data: { 
      classes: classes.map(serialise),
      stats: {
        completedCount,
        upcomingCount,
        overallAttendance
      }
    } 
  });
};

export const createLiveClass = async (req: Request, res: Response) => {
  const { batchId, title, teacherName, scheduledStart, scheduledEnd } = req.body;
  if (!batchId || !title || !teacherName || !scheduledStart || !scheduledEnd) { res.status(400).json({ status: "error", message: "Batch, title, teacher and class timings are required." }); return; }
  const start = new Date(scheduledStart); const end = new Date(scheduledEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) { res.status(400).json({ status: "error", message: "Class end time must be after start time." }); return; }
  const batch = await prisma.batch.findUnique({ where: { id: batchId } });
  if (!batch || batch.status !== "Active") { res.status(400).json({ status: "error", message: "A live class can be created only for an active batch." }); return; }
  const roomName = `kathak-${batch.code.toLowerCase().replace(/[^a-z0-9]/g, "")}-${Date.now().toString(36)}`;
  const liveClass = await prisma.liveClass.create({ data: { batchId, title: String(title).trim(), teacherName: String(teacherName).trim(), scheduledStart: start, scheduledEnd: end, roomName }, include: { batch: { select: { name: true, code: true, courseName: true } } } });
  res.status(201).json({ status: "success", data: serialise(liveClass) });
};

export const setLiveClassStatus = async (req: Request, res: Response) => {
  const id = String(req.params.id); const status = req.body.status as LiveClassStatus;
  if (!["LIVE", "COMPLETED", "CANCELLED"].includes(status)) { res.status(400).json({ status: "error", message: "Invalid live class status." }); return; }
  const liveClass = await prisma.liveClass.update({ where: { id }, data: { status }, include: { batch: { select: { name: true, code: true, courseName: true } } } });
  res.json({ status: "success", data: serialise(liveClass) });
};

export const getLiveClassToken = async (req: Request, res: Response) => {
  if (!agoraKeyReady()) {
    res.status(503).json({ status: "error", message: "Video service is not configured. Add AGORA_APP_ID and AGORA_APP_CERTIFICATE to backend/.env." });
    return;
  }

  if (!process.env.AGORA_APP_ID) {
    res.status(503).json({ status: "error", message: "AGORA_APP_ID is missing on the server. Video cannot start." });
    return;
  }

  const liveClass = await prisma.liveClass.findUnique({ where: { id: String(req.params.id) }, include: { batch: true } });

  if (!liveClass || (liveClass.status !== "LIVE" && liveClass.status !== "SCHEDULED")) {
    res.status(404).json({ status: "error", message: "This class is not available to join." });
    return;
  }

  const user = req.user!;
  const isAdmin = user.role === Role.ADMIN;
  const isTeacher = user.role === Role.TEACHER;
  const now = new Date();

  // ✅ Scheduled class ka end time nikal chuka hai — auto-expire karo
  if (liveClass.status === "SCHEDULED" && now > liveClass.scheduledEnd) {
    const updated = await prisma.liveClass.update({
      where: { id: liveClass.id },
      data: { status: "COMPLETED" },
      include: { batch: { select: { name: true, code: true, courseName: true } } },
    });
    getIO().emit("liveclass:class-updated", serialise(updated)); // ✅ real-time broadcast
    res.status(410).json({ status: "error", message: "This class has ended." });
    return;
  }

  // ✅ LIVE class ka end time bahut nikal chuka hai aur student try kar raha hai — block karo
  if (liveClass.status === "LIVE" && now > liveClass.scheduledEnd && !isTeacher && !isAdmin) {
    res.status(410).json({ status: "error", message: "This class has ended." });
    return;
  }

  // Scheduled class abhi start hi nahi hui — sirf teacher/admin ko allow karo
  if (liveClass.status === "SCHEDULED" && !isTeacher && !isAdmin) {
    res.status(403).json({ status: "error", message: "The class has not started yet." });
    return;
  }

  const agoraClientRole: "publisher" | "subscriber" = "publisher";
  const uid = crypto.randomInt(100000, 999999);

  const token = buildAgoraToken(liveClass.roomName, uid, agoraClientRole);

  // Auto-capture attendance for students when they join
  if (!isAdmin && !isTeacher) {
    // Check if attendance already recorded today for this batch/student
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingAttendance = await prisma.attendance.findFirst({
      where: {
        studentId: user.id,
        batchId: liveClass.batchId,
        date: { gte: today }
      }
    });

    if (!existingAttendance) {
      const studentName = user.fullName?.trim() || "Student";

      await prisma.attendance.create({
        data: {
          studentId: user.id,
          studentName,
          batchId: liveClass.batchId,
          batchName: liveClass.batch.name,
          session: liveClass.title,
          status: "PRESENT",
          date: new Date()
        }
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
    where: { teacherId } as any,
    select: { id: true }
  });
  const batchIds = teacherBatches.map((b) => b.id);

  const classes = await prisma.liveClass.findMany({
    where: {
      ...(batchIds.length > 0 ? { batchId: { in: batchIds } } : {})
    },
    include: { batch: { select: { name: true, code: true, courseName: true } } },
    orderBy: { scheduledStart: "asc" }
  });

  const completedCount = classes.filter(c => c.status === "COMPLETED").length;
  const upcomingCount = classes.filter(c => c.status === "SCHEDULED" || c.status === "LIVE").length;

  // Real attendance rate across this teacher's completed classes, computed
  // from the Attendance table rather than a hardcoded placeholder. Falls
  // back to null (not a made-up percentage) when there's no data yet.
  let overallAttendance: string | null = null;
  if (batchIds.length > 0) {
    const [totalAttendance, presentAttendance] = await Promise.all([
      prisma.attendance.count({ where: { batchId: { in: batchIds } } }),
      prisma.attendance.count({ where: { batchId: { in: batchIds }, status: "PRESENT" } }),
    ]);
    if (totalAttendance > 0) {
      overallAttendance = `${Math.round((presentAttendance / totalAttendance) * 100)}%`;
    }
  }

  res.json({
    status: "success",
    data: {
      classes: classes.map(serialise),
      stats: {
        completedCount,
        upcomingCount,
        overallAttendance
      }
    }
  });
};