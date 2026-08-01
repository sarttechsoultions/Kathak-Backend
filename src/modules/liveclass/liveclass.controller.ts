import { LiveClassStatus, Role } from "@prisma/client";
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";

const serialise = (liveClass: any) => ({ ...liveClass, batchName: liveClass.batch.name, batchCode: liveClass.batch.code, courseName: liveClass.batch.courseName });
const keyReady = () => env.jitsiAppId && env.jitsiKeyId && env.jitsiPrivateKey;

export const listAdminLiveClasses = async (_req: Request, res: Response) => {
  const classes = await prisma.liveClass.findMany({ include: { batch: { select: { name: true, code: true, courseName: true } } }, orderBy: { scheduledStart: "asc" } });
  res.json({ status: "success", data: { classes: classes.map(serialise) } });
};

export const listStudentLiveClasses = async (req: Request, res: Response) => {
  const classes = await prisma.liveClass.findMany({
    where: { batch: { students: { some: { studentId: req.user!.id } } }, status: { in: ["SCHEDULED", "LIVE"] } },
    include: { batch: { select: { name: true, code: true, courseName: true } } }, orderBy: { scheduledStart: "asc" }
  });
  res.json({ status: "success", data: { classes: classes.map(serialise) } });
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
  if (!keyReady()) { res.status(503).json({ status: "error", message: "Jitsi is not configured. Add JITSI_APP_ID, JITSI_KEY_ID and JITSI_PRIVATE_KEY to backend/.env." }); return; }
  const liveClass = await prisma.liveClass.findUnique({ where: { id: String(req.params.id) }, include: { batch: true } });
  if (!liveClass || liveClass.status !== "LIVE") { res.status(404).json({ status: "error", message: "This class is not live." }); return; }
  const user = req.user!;
  const isStaff = user.role === Role.ADMIN || user.role === Role.TEACHER;
  if (!isStaff) {
    const membership = await prisma.batchStudent.findUnique({ where: { batchId_studentId: { batchId: liveClass.batchId, studentId: user.id } } });
    const joinOpensAt = new Date(liveClass.scheduledStart.getTime() - 10 * 60 * 1000);
    if (!membership || new Date() < joinOpensAt) { res.status(403).json({ status: "error", message: "You can join only from 10 minutes before this class." }); return; }
  }
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign({ aud: "jitsi", iss: "chat", sub: env.jitsiAppId, room: liveClass.roomName, nbf: now - 5, exp: now + 60 * 60 * 3, context: { user: { id: user.id, name: user.email, email: user.email, moderator: isStaff }, features: { recording: false, livestreaming: false, transcription: false, outboundCall: false } } }, env.jitsiPrivateKey!, { algorithm: "RS256", keyid: env.jitsiKeyId });
  res.json({ status: "success", data: { token, domain: env.jitsiDomain, appId: env.jitsiAppId, roomName: `${env.jitsiAppId}/${liveClass.roomName}`, liveClass: serialise(liveClass) } });
};
