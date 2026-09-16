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
    if (nextStatus !== LeaveStatus.APPROVED && nextStatus !== LeaveStatus.REJECTED) {
      res.status(400).json({ status: "error", message: "Status must be APPROVED or REJECTED." });
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
      data: { status: nextStatus },
      include: leaveInclude,
    });

    const decision = nextStatus === LeaveStatus.APPROVED ? "approved" : "denied";
    await createNotification(
      leave.userId,
      "LEAVE_REQUEST",
      `Leave request ${decision}`,
      `Your ${leave.leaveType} request from ${leave.startDate.toLocaleDateString("en-IN")} to ${leave.endDate.toLocaleDateString("en-IN")} has been ${decision} by the admin.`,
      leave.user.role === Role.TEACHER ? "/teacher/attendance" : "/student/attendance",
    );

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
