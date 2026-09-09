import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { isOneToOneBatch } from "../../lib/batchHelpers";

const STATUS_PENDING = "PENDING_TEACHER";
const STATUS_TEACHER_APPROVED = "TEACHER_APPROVED";
const STATUS_TEACHER_REJECTED = "TEACHER_REJECTED";
const STATUS_ADMIN_REJECTED = "ADMIN_REJECTED";
const STATUS_RESCHEDULED = "RESCHEDULED";
const STATUS_CANCELLED = "CANCELLED";

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
    const yyyy = liveClass.scheduledStart.getFullYear();
    const mm = String(liveClass.scheduledStart.getMonth() + 1).padStart(2, "0");
    const monthlyPeriod = `${yyyy}-${mm}`;

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

    // Notify Teacher and Admin
    if (teacherId) {
      await prisma.notification.create({
        data: {
          userId: teacherId,
          type: "RESCHEDULE_REQUEST",
          title: "New Reschedule Request",
          message: `${user.fullName} has requested to reschedule ${liveClass.title}.`,
        },
      });
    }

    const admins = await prisma.user.findMany({ where: { role: "ADMIN" } });
    const adminNotifs = admins.map(a => ({
      userId: a.id,
      type: "RESCHEDULE_REQUEST",
      title: "New Reschedule Request",
      message: `${user.fullName} has requested to reschedule ${liveClass.title}.`,
    }));
    if (adminNotifs.length > 0) {
      await prisma.notification.createMany({ data: adminNotifs });
    }

    res.status(201).json({ status: "success", data: request });
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

    const newStatus = action === "APPROVE" ? STATUS_TEACHER_APPROVED : STATUS_TEACHER_REJECTED;

    const updated = await prisma.classRescheduleRequest.update({
      where: { id },
      data: {
        status: newStatus,
        teacherResponse: note || null,
      },
    });

    await prisma.notification.create({
      data: {
        userId: request.studentId,
        type: "RESCHEDULE_RESPONSE",
        title: "Reschedule Request Update",
        message: `Your teacher has ${action.toLowerCase()}d your reschedule request.`,
      },
    });

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
      await prisma.notification.createMany({
        data: [
          { userId: result.studentId, type: "RESCHEDULE_FINALIZED", title: "Reschedule Finalized", message: "Your reschedule request has been finalized." },
          { userId: result.teacherId, type: "RESCHEDULE_FINALIZED", title: "Reschedule Finalized", message: "A reschedule request has been finalized." },
        ]
      });
    } else {
      await prisma.notification.create({
        data: { userId: result.studentId, type: "RESCHEDULE_REJECTED", title: "Reschedule Rejected", message: "Your reschedule request was rejected by admin." }
      });
    }

    res.json({ status: "success", data: result });
  } catch (error: any) {
    res.status(400).json({ status: "error", message: error.message || "Error" });
  }
};
