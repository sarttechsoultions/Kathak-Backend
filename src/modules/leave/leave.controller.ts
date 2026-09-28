import { LeaveStatus, Role } from "@prisma/client";
import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { createNotification } from "../notification/notification.controller";

const leaveInclude = {
  user: {
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      batchMemberships: {
        select: { batch: { select: { id: true, name: true, teacherId: true, teacherName: true } } },
      },
    },
  },
} as const;

export const getAdminLeaveRequests = async (_req: Request, res: Response): Promise<void> => {
  try {
    const requests = await prisma.leaveRequest.findMany({
      include: leaveInclude,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
    res.json({ status: "success", data: requests });
  } catch (error) {
    console.error("Get admin leave requests error:", error);
    res.status(500).json({ status: "error", message: "Failed to load leave requests." });
  }
};

export const reviewLeaveRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const nextStatus = String(req.body?.status || "").toUpperCase();
    const reviewReason = String(req.body?.reviewReason || "").trim().slice(0, 2000);
    if (nextStatus !== LeaveStatus.APPROVED && nextStatus !== LeaveStatus.REJECTED) {
      res.status(400).json({ status: "error", message: "Status must be APPROVED or REJECTED." });
      return;
    }
    if (nextStatus === LeaveStatus.REJECTED && !reviewReason) {
      res.status(400).json({ status: "error", message: "A reason is required before rejecting a leave request." });
      return;
    }

    const leave = await prisma.leaveRequest.findUnique({
      where: { id: String(req.params.id) },
      include: { user: { select: { fullName: true, role: true } } },
    });
    if (!leave) {
      res.status(404).json({ status: "error", message: "Leave request not found." });
      return;
    }
    if (leave.status !== LeaveStatus.PENDING) {
      res.status(409).json({ status: "error", message: "This leave request has already been reviewed." });
      return;
    }

    const updated = await prisma.leaveRequest.update({
      where: { id: leave.id },
      data: { status: nextStatus, reviewReason: reviewReason || null },
      include: leaveInclude,
    });

    const decision = nextStatus === LeaveStatus.APPROVED ? "approved" : "denied";
    
    // A notification failure must not undo or mask a completed leave decision.
    try {
    // Notify the user who requested the leave
    await createNotification(
      leave.userId,
      "LEAVE_REQUEST",
      `Leave request ${decision}`,
      `Your ${leave.leaveType} request from ${leave.startDate.toLocaleDateString("en-IN")} to ${leave.endDate.toLocaleDateString("en-IN")} has been ${decision} by the admin.${reviewReason ? ` Reason: ${reviewReason}` : ""}`,
      leave.user.role === Role.TEACHER ? "/teacher/attendance" : "/student/attendance",
    );

    // If the user is a student, notify their teachers
    if (leave.user.role === Role.STUDENT) {
      const memberships = await prisma.batchStudent.findMany({
        where: { studentId: leave.userId },
        include: { batch: { select: { teacherId: true } } },
      });
      const teacherIds = [...new Set(memberships.map(m => m.batch.teacherId).filter(Boolean))] as string[];
      
      await Promise.all(teacherIds.map(teacherId => createNotification(
        teacherId,
        "LEAVE_REQUEST",
        `Student leave ${decision}`,
        `${leave.user.fullName}'s ${leave.leaveType} request has been ${decision} by the admin.`,
        "/teacher/attendance/leave-requests"
      )));
    }
    } catch (notificationError) {
      console.error("Leave review notification error:", notificationError);
    }

    res.json({ status: "success", message: `Leave request ${decision}.`, data: updated });
  } catch (error) {
    console.error("Review leave request error:", error);
    res.status(500).json({ status: "error", message: "Failed to review leave request." });
  }
};

export const getTeacherStudentLeaveRequests = async (req: Request, res: Response): Promise<void> => {
  try {
    const teacherId = req.user!.id;
    const batches = await prisma.batch.findMany({ where: { teacherId }, select: { id: true } });
    const batchIds = batches.map((batch) => batch.id);
    const memberships = batchIds.length
      ? await prisma.batchStudent.findMany({ where: { batchId: { in: batchIds } }, select: { studentId: true } })
      : [];
    const studentIds = [...new Set(memberships.map((membership) => membership.studentId))];

    const requests = studentIds.length
      ? await prisma.leaveRequest.findMany({
          where: { userId: { in: studentIds } },
          include: leaveInclude,
          orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        })
      : [];

    res.json({ status: "success", data: requests });
  } catch (error) {
    console.error("Get teacher student leave requests error:", error);
    res.status(500).json({ status: "error", message: "Failed to load student leave requests." });
  }
};

export const reviewTeacherStudentLeaveRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const nextStatus = String(req.body?.status || "").toUpperCase();
    const reviewReason = String(req.body?.reviewReason || "").trim().slice(0, 2000);
    if (nextStatus !== LeaveStatus.APPROVED && nextStatus !== LeaveStatus.REJECTED) {
      res.status(400).json({ status: "error", message: "Status must be APPROVED or REJECTED." });
      return;
    }
    if (nextStatus === LeaveStatus.REJECTED && !reviewReason) {
      res.status(400).json({ status: "error", message: "A reason is required before rejecting a leave request." });
      return;
    }

    const leave = await prisma.leaveRequest.findUnique({ where: { id: String(req.params.id) } });
    if (!leave) {
      res.status(404).json({ status: "error", message: "Leave request not found." });
      return;
    }
    if (leave.status !== LeaveStatus.PENDING) {
      res.status(409).json({ status: "error", message: "This leave request has already been reviewed." });
      return;
    }

    const teacherBatches = await prisma.batch.findMany({ where: { teacherId: req.user!.id }, select: { id: true } });
    const isAssignedStudent = teacherBatches.length > 0 && await prisma.batchStudent.findFirst({
      where: { studentId: leave.userId, batchId: { in: teacherBatches.map((batch) => batch.id) } },
      select: { id: true },
    });
    if (!isAssignedStudent) {
      res.status(403).json({ status: "error", message: "You can only review leave requests from your assigned students." });
      return;
    }

    const updated = await prisma.leaveRequest.update({
      where: { id: leave.id },
      data: { status: nextStatus, reviewReason: reviewReason || null },
      include: leaveInclude,
    });
    const decision = nextStatus === LeaveStatus.APPROVED ? "approved" : "denied";
    await createNotification(
      leave.userId,
      "LEAVE_REQUEST",
      `Leave request ${decision}`,
      `Your ${leave.leaveType} request has been ${decision} by your teacher.${reviewReason ? ` Reason: ${reviewReason}` : ""}`,
      "/student/attendance",
    );
    res.json({ status: "success", message: `Leave request ${decision}.`, data: updated });
  } catch (error) {
    console.error("Review teacher leave request error:", error);
    res.status(500).json({ status: "error", message: "Failed to review leave request." });
  }
};
