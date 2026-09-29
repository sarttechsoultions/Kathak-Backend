import { Request, Response } from "express";
import crypto from "crypto";
import { Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { generatePdfBuffer } from "../../lib/invoice";

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

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function certificatePdfHtml(certificate: any): string {
  const issuedOn = new Intl.DateTimeFormat("en-IN", {
    day: "numeric", month: "long", year: "numeric",
  }).format(new Date(certificate.issuedAt));
  const studentName = escapeHtml(certificate.student.fullName);
  const courseTitle = escapeHtml(certificate.course.title);
  const batchName = certificate.batch?.name ? escapeHtml(certificate.batch.name) : "";
  const achievement = certificate.achievement ? escapeHtml(certificate.achievement) : "";
  const typeLabel = certificate.type === "APPRECIATION" ? "Certificate of Appreciation" : "Certificate of Completion";

  return `<!doctype html>
<html><head><meta charset="utf-8"/><style>
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Georgia, 'Times New Roman', serif; color: #2b0b3f; }
  .certificate { width: 297mm; height: 210mm; position: relative; overflow: hidden; background: #fffdf6; padding: 16mm; }
  .frame { position: absolute; inset: 8mm; border: 2px solid #caa647; }
  .frame::after { content: ''; position: absolute; inset: 4mm; border: 1px solid #8a001a; }
  .content { height: 100%; position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .academy { color: #8a001a; font-size: 15pt; font-weight: bold; letter-spacing: 1.5px; margin-top: 4mm; }
  .title { color: #8a001a; font-size: 30pt; font-weight: bold; margin: 14mm 0 6mm; }
  .presented { font-family: Arial, sans-serif; font-size: 10pt; letter-spacing: 2.5px; }
  .name { color: #c89422; font-size: 43pt; font-style: italic; font-weight: bold; margin: 10mm 0 7mm; max-width: 230mm; }
  .line { width: 150mm; border-top: 1px solid #caa647; }
  .statement { font-size: 17pt; line-height: 1.5; margin: 10mm 20mm 0; }
  .course { color: #8a001a; font-weight: bold; }
  .footer { position: absolute; left: 22mm; right: 22mm; bottom: 19mm; display: flex; align-items: end; justify-content: space-between; text-align: left; font-family: Arial, sans-serif; font-size: 9pt; }
  .footer strong { color: #8a001a; }
  .signature { text-align: center; min-width: 57mm; }
  .signature-name { color: #8a001a; font-family: cursive; font-size: 23pt; margin-bottom: 2mm; }
  .signature-line { border-top: 1px solid #2b0b3f; padding-top: 2mm; }
</style></head><body>
  <main class="certificate"><div class="frame"></div><section class="content">
    <div class="academy">KATHAK BY HARSHITA ACADEMY</div>
    <h1 class="title">${typeLabel}</h1>
    <div class="presented">THIS CERTIFICATE IS PROUDLY PRESENTED TO</div>
    <div class="name">${studentName}</div><div class="line"></div>
    <p class="statement">${certificate.type === "APPRECIATION" ? "In recognition of outstanding dedication and performance in" : "For successfully completing"}<br/><span class="course">${courseTitle}</span>${achievement ? `<br/>${achievement}` : ""}${batchName ? `<br/><small>${batchName}</small>` : ""}</p>
    <footer class="footer"><div><strong>Date of issue</strong><br/>${issuedOn}<br/><span>Certificate No. ${escapeHtml(certificate.code)}</span></div><div class="signature"><div class="signature-name">Harshita</div><div class="signature-line"><strong>Harshita Sharma</strong><br/>Director</div></div></footer>
  </section></main>
</body></html>`;
}

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

export async function downloadStudentCertificate(req: Request, res: Response): Promise<void> {
  const certificate = await (prisma as any).certificate.findFirst({
    where: { id: String(req.params.id), studentId: req.user!.id },
    include: certificateInclude,
  });

  if (!certificate) {
    res.status(404).json({ status: "error", message: "Certificate not found." });
    return;
  }
  if (certificate.revokedAt) {
    res.status(410).json({ status: "error", message: "This certificate has been revoked and cannot be downloaded." });
    return;
  }

  try {
    const pdf = await generatePdfBuffer(certificatePdfHtml(certificate));
    const safeCode = String(certificate.code).replace(/[^a-zA-Z0-9_-]/g, "_");
    res.status(200)
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="kathak-certificate-${safeCode}.pdf"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": "private, no-store",
      })
      .send(pdf);
  } catch (error) {
    console.error("Certificate PDF generation error:", error);
    res.status(500).json({ status: "error", message: "Could not generate the certificate PDF. Please try again." });
  }
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
