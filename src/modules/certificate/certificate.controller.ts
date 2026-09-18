import { Request, Response } from "express";
import crypto from "crypto";
import { Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";

const certificateInclude = {
  student: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
  course: { select: { id: true, title: true } },
  batch: { select: { id: true, name: true, code: true } },
  issuedBy: { select: { fullName: true } },
};

const serialize = (certificate: any) => ({
  id: certificate.id,
  code: certificate.code,
  type: certificate.type,
  achievement: certificate.achievement,
  courseDuration: certificate.courseDuration ?? null,
  classMode: certificate.classMode ?? null,
  issuedAt: certificate.issuedAt,
  revokedAt: certificate.revokedAt,
  status: certificate.revokedAt ? "REVOKED" : "ISSUED",
  student: certificate.student,
  course: certificate.course,
  batch: certificate.batch,
  issuedBy: certificate.issuedBy?.fullName || "Kathak by Harshita Academy",
});

export async function listCertificates(_req: Request, res: Response): Promise<void> {
  const certificates = await (prisma as any).certificate.findMany({
    include: certificateInclude,
    orderBy: { issuedAt: "desc" },
  });
  res.json({ status: "success", data: { certificates: certificates.map(serialize) } });
}

export async function issueCertificate(req: Request, res: Response): Promise<void> {
  const { studentId, courseId, batchId, type = "COMPLETION", achievement, issuedAt, courseDuration, classMode } = req.body;
  if (!studentId || !courseId) {
    res.status(400).json({ status: "error", message: "Student and course are required." });
    return;
  }

  const [student, course, batch] = await Promise.all([
    prisma.user.findFirst({ where: { id: String(studentId), role: Role.STUDENT } }),
    prisma.course.findUnique({ where: { id: String(courseId) } }),
    batchId ? prisma.batch.findUnique({ where: { id: String(batchId) }, include: { students: { where: { studentId: String(studentId) } } } }) : null,
  ]);
  if (!student || !course) {
    res.status(404).json({ status: "error", message: "Selected student or course was not found." });
    return;
  }
  if (batchId && (!batch || batch.courseId !== course.id || batch.students.length === 0)) {
    res.status(400).json({ status: "error", message: "The student must belong to the selected batch for this course." });
    return;
  }

  const code = `KBH-${new Date().getFullYear()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const certificate = await (prisma as any).certificate.create({
    data: {
      code,
      studentId: student.id,
      courseId: course.id,
      batchId: batch?.id || null,
      type: String(type).toUpperCase() === "APPRECIATION" ? "APPRECIATION" : "COMPLETION",
      achievement: achievement?.trim() || null,
      issuedAt: issuedAt ? new Date(issuedAt) : new Date(),
      issuedById: req.user?.id || null,
      courseDuration: courseDuration?.trim() || null,
      classMode: classMode?.trim() || null,
    },
    include: certificateInclude,
  });
  res.status(201).json({ status: "success", data: { certificate: serialize(certificate) } });
}

export async function revokeCertificate(req: Request, res: Response): Promise<void> {
  const certificate = await (prisma as any).certificate.update({
    where: { id: String(req.params.id) },
    data: { revokedAt: new Date() },
    include: certificateInclude,
  });
  res.json({ status: "success", data: { certificate: serialize(certificate) } });
}

export async function getStudentCertificates(req: Request, res: Response): Promise<void> {
  const certificates = await (prisma as any).certificate.findMany({
    where: { studentId: req.user!.id }, include: certificateInclude, orderBy: { issuedAt: "desc" },
  });
  res.json({ status: "success", data: { certificates: certificates.map(serialize) } });
}

export async function verifyCertificate(req: Request, res: Response): Promise<void> {
  const certificate = await (prisma as any).certificate.findUnique({
    where: { code: String(req.params.code) }, include: certificateInclude,
  });
  if (!certificate) {
    res.status(404).json({ status: "error", message: "Certificate not found." });
    return;
  }
  res.json({ status: "success", data: { certificate: serialize(certificate) } });
}
