import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { isOneToOneBatch } from "../../lib/batchHelpers";
import { createNotification, createNotifications } from "../notification/notification.controller";
import { sendEmail } from "../../lib/mailer";

const STATUS_PENDING = "PENDING_TEACHER";
const STATUS_TEACHER_APPROVED = "TEACHER_APPROVED";
const STATUS_TEACHER_REJECTED = "TEACHER_REJECTED";
const STATUS_ADMIN_REJECTED = "ADMIN_REJECTED";
const STATUS_RESCHEDULED = "RESCHEDULED";
const STATUS_CANCELLED = "CANCELLED";
const ACADEMY_EMAIL = "kathakbyharshita@gmail.com";

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const formatIstDateTime = (value: Date) =>
  value.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });

const getIstMonthlyPeriod = (value: Date) => {
  const parts = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Asia/Kolkata",
  }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
};

export const createRescheduleRequest = async (req: Request, res: Response) => {
  try {
    const { classId, requestedDate, reason } = req.body;
    const user = (req as any).user;

    if (user.role !== "STUDENT") {
      res.status(403).json({ status: "error", message: "Only students can request a reschedule." });
      return;
    }

    if (!classId || !requestedDate) {
      res.status(400).json({ status: "error", message: "Class ID and requested date are required." });
      return;
    }

    const newDate = new Date(requestedDate);
    if (newDate <= new Date()) {
      res.status(400).json({ status: "error", message: "Requested date must be in the future." });
      return;
    }

    const liveClass = await prisma.liveClass.findUnique({
      where: { id: classId },
      include: {
        batch: {
          include: {
            students: { where: { studentId: user.id } },
          },
        },
      },
    });

    if (!liveClass) {
      res.status(404).json({ status: "error", message: "Class not found." });
      return;
    }

    if (liveClass.status !== "SCHEDULED") {
      res.status(400).json({ status: "error", message: "Only scheduled classes can be rescheduled." });
      return;
    }

    if (!isOneToOneBatch(liveClass.batch.name, liveClass.batch.code)) {
      res.status(400).json({ status: "error", message: "Rescheduling is only allowed for 1-to-1 personal batches." });
      return;
    }

    if (liveClass.batch.students.length === 0) {
      res.status(403).json({ status: "error", message: "You are not enrolled in this batch." });
      return;
    }

    // Determine monthly period based on original scheduled start
    const monthlyPeriod = getIstMonthlyPeriod(liveClass.scheduledStart);

    // Check allowance
    const existingRequests = await prisma.classRescheduleRequest.findMany({
      where: {
        studentId: user.id,
        monthlyPeriod,
        status: { in: [STATUS_PENDING, STATUS_TEACHER_APPROVED, STATUS_RESCHEDULED] },
      },
    });

    if (existingRequests.length > 0) {
      // Check if they are trying to reschedule the EXACT same class again
      const sameClassReq = existingRequests.find((r: any) => r.liveClassId === liveClass.id);
      if (sameClassReq) {
        res.status(400).json({ status: "error", message: "You already have an active request for this class." });
        return;
      }
      res.status(400).json({ status: "error", message: "You have already used or requested your 1 allowed reschedule for this month." });
      return;
    }

    // Teacher conflict check (preliminary)
    const durationMs = liveClass.scheduledEnd.getTime() - liveClass.scheduledStart.getTime();
    const requestedEnd = new Date(newDate.getTime() + durationMs);

    const teacherId = liveClass.batch.teacherId;
    if (teacherId) {
      const conflictingClass = await prisma.liveClass.findFirst({
        where: {
          batch: { teacherId },
          status: { in: ["SCHEDULED", "LIVE"] },
          id: { not: liveClass.id }, // don't conflict with itself
          AND: [
            { scheduledStart: { lt: requestedEnd } },
            { scheduledEnd: { gt: newDate } },
          ],
        },
      });

      if (conflictingClass) {
        res.status(400).json({ status: "error", message: "The requested time conflicts with the teacher's schedule." });
        return;
      }
    }

    const request = await prisma.classRescheduleRequest.create({
      data: {
        liveClassId: liveClass.id,
        studentId: user.id,
        teacherId: teacherId || "",
        batchId: liveClass.batchId,
        originalDate: liveClass.scheduledStart,
        requestedDate: newDate,
        reason: reason || null,
        monthlyPeriod,
        status: "PENDING_TEACHER",
      },
    });

    const notificationMessage = `${user.fullName || user.email} requested ${formatIstDateTime(newDate)} for ${liveClass.title}.`;

    // Persist targeted notifications for both decision makers. Explicit links
    // make the notification useful even when socket delivery is unavailable.
    if (teacherId) {
      await createNotification(
        teacherId,
        "RESCHEDULE_REQUEST",
        "New Reschedule Request",
        notificationMessage,
        "/teacher/reschedule-requests"
      );
    }

    const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
    const adminNotifs = admins.map(a => ({
      userId: a.id,
      type: "RESCHEDULE_REQUEST",
      title: "New Reschedule Request",
      message: notificationMessage,
      link: "/admin/reschedule-requests",
    }));
    if (adminNotifs.length > 0) {
      await createNotifications(adminNotifs);
    }

    const teacher = teacherId
      ? await prisma.user.findUnique({ where: { id: teacherId }, select: { fullName: true, email: true } })
      : null;
    const emailSent = await sendEmail({
      to: ACADEMY_EMAIL,
      subject: `New class reschedule request from ${user.fullName || user.email}`,
      html: `
        <h2 style="margin:0 0 14px;color:#900C27;">New class reschedule request</h2>
        <p>A student has submitted a new 1-to-1 class reschedule request.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="8" style="border-collapse:collapse;background:#fff8f8;border:1px solid #eadde0;">
          <tr><td><strong>Student</strong></td><td>${escapeHtml(user.fullName || user.email)}</td></tr>
          <tr><td><strong>Class</strong></td><td>${escapeHtml(liveClass.title)}</td></tr>
          <tr><td><strong>Teacher</strong></td><td>${escapeHtml(teacher?.fullName || teacher?.email || "Not assigned")}</td></tr>
          <tr><td><strong>Original time</strong></td><td>${escapeHtml(formatIstDateTime(liveClass.scheduledStart))}</td></tr>
          <tr><td><strong>Requested time</strong></td><td>${escapeHtml(formatIstDateTime(newDate))}</td></tr>
          <tr><td><strong>Reason</strong></td><td>${escapeHtml(reason || "Not provided")}</td></tr>
        </table>
        <p style="margin-top:18px;"><a href="https://www.kathakbyharshita.com/admin/reschedule-requests" style="color:#900C27;font-weight:700;">Open reschedule requests</a></p>
      `,
    });
    if (!emailSent) {
      console.error(`[RESCHEDULE_EMAIL_FAILURE] Academy email failed for request ${request.id}.`);
    }

    res.status(201).json({ status: "success", data: request, emailSent });
  } catch (error) {
    console.error("createRescheduleRequest error:", error);
    res.status(500).json({ status: "error", message: "Internal server error" });
  }
};

export const getRescheduleRequests = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    let where: any = {};

    if (user.role === "STUDENT") {
      where.studentId = user.id;
    } else if (user.role === "TEACHER") {
      where.teacherId = user.id;
    }

    const requests = await prisma.classRescheduleRequest.findMany({
      where,
      include: {
        liveClass: { select: { title: true } },
        student: { select: { fullName: true, email: true } },
        teacher: { select: { fullName: true, email: true } },
        batch: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ status: "success", data: requests });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Internal server error" });
  }
};

export const teacherResponse = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { action, note } = req.body;
    const user = (req as any).user;

    if (user.role !== "TEACHER") {
      res.status(403).json({ status: "error", message: "Only teachers can respond." });
      return;
    }

    const request = await prisma.classRescheduleRequest.findUnique({
      where: { id },
      include: {
        liveClass: { select: { title: true } },
        student: { select: { fullName: true, email: true } },
        teacher: { select: { fullName: true } },
      },
    });

    if (!request) {
      res.status(404).json({ status: "error", message: "Request not found." });
      return;
    }

    if (request.teacherId !== user.id) {
      res.status(403).json({ status: "error", message: "Unauthorized." });
      return;
    }

    if (request.status !== STATUS_PENDING) {
      res.status(400).json({ status: "error", message: `Cannot respond to a request in ${request.status} state.` });
      return;
    }

    if (action !== "APPROVE" && action !== "REJECT") {
      res.status(400).json({ status: "error", message: "Invalid action. Use APPROVE or REJECT." });
      return;
    }

    const responseNote = typeof note === "string" ? note.trim() : "";
    if (action === "REJECT" && !responseNote) {
      res.status(400).json({ status: "error", message: "Please provide a rejection reason." });
      return;
    }

    const newStatus = action === "APPROVE" ? STATUS_TEACHER_APPROVED : STATUS_TEACHER_REJECTED;

    const updated = await prisma.classRescheduleRequest.update({
      where: { id },
      data: {
        status: newStatus,
        teacherResponse: responseNote || null,
      },
    });

    const studentMessage = action === "REJECT"
      ? `Your reschedule request for ${request.liveClass.title} was rejected. Reason: ${responseNote}`
      : `Your teacher approved your reschedule request for ${request.liveClass.title}. It is now waiting for admin confirmation.`;
    await createNotification(
      request.studentId,
      "RESCHEDULE_RESPONSE",
      action === "REJECT" ? "Reschedule Request Rejected" : "Reschedule Request Approved",
      studentMessage,
      "/student/classes"
    );

    const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
    const adminMessage = action === "REJECT"
      ? `${request.teacher.fullName} rejected ${request.student.fullName}'s reschedule request. Reason: ${responseNote}`
      : `${request.teacher.fullName} approved ${request.student.fullName}'s reschedule request. Admin confirmation is required.`;
    await createNotifications(admins.map((admin) => ({
      userId: admin.id,
      type: "RESCHEDULE_RESPONSE",
      title: action === "REJECT" ? "Teacher Rejected Reschedule" : "Reschedule Awaiting Confirmation",
      message: adminMessage,
      link: "/admin/reschedule-requests",
    })));

    res.json({ status: "success", data: updated });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Internal server error" });
  }
};

export const adminFinalize = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { action, note } = req.body;
    const user = (req as any).user;

    if (user.role !== "ADMIN") {
      res.status(403).json({ status: "error", message: "Only admins can finalize." });
      return;
    }

    if (action !== "APPROVE" && action !== "REJECT") {
      res.status(400).json({ status: "error", message: "Invalid action." });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const request = (await tx.classRescheduleRequest.findUnique({
        where: { id },
        include: { liveClass: { include: { batch: true } } },
      })) as any;

      if (!request) throw new Error("Request not found.");

      if (action === "REJECT") {
        if (request.status === STATUS_RESCHEDULED || request.status === STATUS_CANCELLED) {
          throw new Error("Cannot reject this request.");
        }
        return await tx.classRescheduleRequest.update({
          where: { id },
          data: { status: STATUS_ADMIN_REJECTED, adminNotes: note },
        });
      }

      // Finalize Approval
      if (request.status !== STATUS_TEACHER_APPROVED) {
        throw new Error("Only TEACHER_APPROVED requests can be finalized.");
      }

      if (request.liveClass.status !== "SCHEDULED") {
        throw new Error("Class is no longer scheduled and cannot be rescheduled.");
      }

      // Re-verify monthly allowance
      const existingRescheduled = await tx.classRescheduleRequest.findFirst({
        where: {
          studentId: request.studentId,
          monthlyPeriod: request.monthlyPeriod,
          status: STATUS_RESCHEDULED,
        },
      });

      if (existingRescheduled) {
        throw new Error("Student has already completed a reschedule in this monthly period.");
      }

      // Check teacher conflict
      const durationMs = request.liveClass.scheduledEnd.getTime() - request.liveClass.scheduledStart.getTime();
      const requestedEnd = new Date(request.requestedDate.getTime() + durationMs);

      const conflictingClass = await tx.liveClass.findFirst({
        where: {
          batch: { teacherId: request.teacherId },
          status: { in: ["SCHEDULED", "LIVE"] },
          id: { not: request.liveClassId },
          AND: [
            { scheduledStart: { lt: requestedEnd } },
            { scheduledEnd: { gt: request.requestedDate } },
          ],
        },
      });

      if (conflictingClass) {
        throw new Error("Teacher schedule conflict detected for the requested time.");
      }

      // Update class atomically
      const liveClassUpdate = await tx.liveClass.updateMany({
        where: { id: request.liveClassId, status: "SCHEDULED" },
        data: {
          scheduledStart: request.requestedDate,
          scheduledEnd: requestedEnd,
        },
      });

      if (liveClassUpdate.count === 0) {
        throw new Error("Class is no longer scheduled or was already updated concurrently.");
      }

      // Update request atomically
      const requestUpdate = await tx.classRescheduleRequest.updateMany({
        where: { id, status: STATUS_TEACHER_APPROVED },
        data: { status: STATUS_RESCHEDULED, adminNotes: note },
      });

      if (requestUpdate.count === 0) {
        throw new Error("Request was already finalized concurrently.");
      }

      return { ...request, status: STATUS_RESCHEDULED };
    });

    if (result.status === STATUS_RESCHEDULED) {
      await createNotifications([
          { userId: result.studentId, type: "RESCHEDULE_FINALIZED", title: "Reschedule Finalized", message: "Your reschedule request has been finalized." },
          { userId: result.teacherId, type: "RESCHEDULE_FINALIZED", title: "Reschedule Finalized", message: "A reschedule request has been finalized." },
        ]);
    } else {
      await createNotification(result.studentId, "RESCHEDULE_REJECTED", "Reschedule Rejected", "Your reschedule request was rejected by admin.");
    }

    res.json({ status: "success", data: result });
  } catch (error: any) {
    res.status(400).json({ status: "error", message: error.message || "Error" });
  }
};
