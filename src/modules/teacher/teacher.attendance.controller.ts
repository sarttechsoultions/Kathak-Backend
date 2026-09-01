import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

export const getTeacherAttendance = async (req: Request, res: Response) => {
  try {
    const teacherId = req.user!.id;

    const teacher = await prisma.user.findUnique({ where: { id: teacherId } });
    if (!teacher) {
      return res.status(404).json({ status: "error", message: "Teacher not found" });
    }

    const attendanceLogs = await prisma.attendance.findMany({
      where: {
        studentId: teacherId,
        batchName: "Teacher/Staff",
      },
      orderBy: { date: "desc" },
    });

    const leaveRequests = await prisma.leaveRequest.findMany({
      where: { userId: teacherId },
      orderBy: { startDate: "desc" },
    });

    const logs = [
      ...attendanceLogs.map((record) => ({
        id: record.id,
        date: record.date,
        type: "attendance" as const,
        day: record.date.toLocaleDateString("en-US", { weekday: "long" }),
        session: record.session || "General",
        checkIn:
          record.status === "PRESENT" || record.status === "LATE"
            ? record.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "--",
        checkOut: "--",
        totalHours: "--",
        remarks: record.remarks || "",
        status: record.status,
      })),
      ...leaveRequests.map((leave) => ({
        id: leave.id,
        date: leave.startDate,
        type: "leave" as const,
        day: leave.startDate.toLocaleDateString("en-US", { weekday: "long" }),
        session: `${leave.leaveType} Leave`,
        checkIn: "--",
        checkOut: "--",
        totalHours: leave.totalDays > 1 ? `${leave.totalDays} days` : "--",
        remarks: leave.reason,
        status:
          leave.status === "APPROVED"
            ? "LEAVE"
            : leave.status === "PENDING"
              ? "PENDING"
              : "REJECTED",
      })),
    ].sort((a, b) => b.date.getTime() - a.date.getTime());

    const presentCount = attendanceLogs.filter((record) => record.status === "PRESENT").length;
    const absentCount = attendanceLogs.filter((record) => record.status === "ABSENT").length;
    const lateCount = attendanceLogs.filter((record) => record.status === "LATE").length;
    const leaveCount =
      attendanceLogs.filter((record) => record.status === "LEAVE").length +
      leaveRequests.reduce((acc, curr) => acc + curr.totalDays, 0);

    const totalDays = presentCount + absentCount + lateCount + leaveCount;
    const overallAttendance = totalDays > 0 ? Math.round((presentCount / totalDays) * 100) : 100;

    let currentStreak = 0;
    const sortedAttendance = [...attendanceLogs].sort((a, b) => b.date.getTime() - a.date.getTime());
    for (const log of sortedAttendance) {
      if (log.status === "PRESENT") currentStreak++;
      else break;
    }

    res.json({
      status: "success",
      data: {
        logs,
        stats: {
          overallAttendance,
          totalWorkingDays: totalDays || 0,
          presentDays: presentCount,
          totalAbsent: absentCount,
          totalLeaves: leaveCount,
          lateDays: lateCount,
          currentStreak,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching teacher attendance:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch attendance" });
  }
};

export const applyTeacherLeave = async (req: Request, res: Response) => {
  try {
    const teacherId = req.user!.id;
    const { leaveType, startDate, endDate, totalDays, reason, attachment, handoverNotes } = req.body;

    if (!startDate || !endDate || !leaveType || !reason) {
      return res.status(400).json({ status: "error", message: "Missing required fields" });
    }

    const user = await prisma.user.findUnique({ where: { id: teacherId } });
    const teacherName = user?.fullName || "Teacher";

    const combinedReason = handoverNotes
      ? `${reason.trim()}\n\nHandover Notes: ${String(handoverNotes).trim()}`
      : reason.trim();

    const leaveRequest = await prisma.leaveRequest.create({
      data: {
        userId: teacherId,
        userName: teacherName,
        leaveType,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        totalDays: Number(totalDays),
        reason: combinedReason,
        attachment,
      },
    });

    res.json({
      status: "success",
      message: "Leave application submitted successfully",
      data: leaveRequest,
    });
  } catch (error) {
    console.error("Error submitting teacher leave:", error);
    res.status(500).json({ status: "error", message: "Failed to submit leave application" });
  }
};
