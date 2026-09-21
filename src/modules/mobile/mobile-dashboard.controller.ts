import { AttendanceStatus } from "@prisma/client";
import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

const monthBounds = (value: unknown) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})$/);
  const now = new Date();
  const year = match ? Number(match[1]) : now.getFullYear();
  const month = match ? Number(match[2]) - 1 : now.getMonth();
  if (month < 0 || month > 11) return null;
  return { start: new Date(Date.UTC(year, month, 1)), end: new Date(Date.UTC(year, month + 1, 1)) };
};

const greetingFor = (hour: number) =>
  hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";

/** One compact payload for the authenticated mobile student home screen. */
export const getMobileDashboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const range = monthBounds(req.query.month);
    if (!range) {
      res.status(400).json({ status: "error", message: "month must use YYYY-MM format." });
      return;
    }

    const student = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        avatarUrl: true,
        batchMemberships: { select: { batchId: true } },
        enrollments: { where: { active: true }, select: { id: true }, take: 1 },
      },
    });
    if (!student) {
      res.status(404).json({ status: "error", message: "Student profile not found." });
      return;
    }
    if (student.enrollments.length === 0) {
      res.status(403).json({
        status: "error",
        code: "ENROLLMENT_REQUIRED",
        message: "Please enroll in a course before opening the dashboard.",
        data: { nextScreen: "COURSE_EXPLORE" },
      });
      return;
    }

    const batchIds = student.batchMemberships.map((membership) => membership.batchId);
    const assignmentScope = batchIds.length ? { OR: [{ batchId: { in: batchIds } }, { batchId: null }] } : { batchId: null };
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const tomorrow = new Date(todayStart);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [attendance, assignments, assignmentCount, liveClasses] = await Promise.all([
      prisma.attendance.findMany({
        where: { studentId: userId, date: { gte: range.start, lt: range.end } },
        select: { date: true, status: true },
        orderBy: { date: "asc" },
      }),
      prisma.assignment.findMany({
        where: { ...assignmentScope, status: "ACTIVE" },
        orderBy: { dueDate: "asc" },
        take: 3,
        include: { submissions: { where: { studentId: userId }, select: { id: true, status: true, grade: true, feedback: true } } },
      }),
      prisma.assignment.count({ where: { ...assignmentScope, status: "ACTIVE" } }),
      batchIds.length
        ? prisma.liveClass.findMany({
            where: { batchId: { in: batchIds }, status: { notIn: ["COMPLETED", "CANCELLED"] }, scheduledEnd: { gt: now } },
            orderBy: { scheduledStart: "asc" },
            take: 3,
          })
        : Promise.resolve([]),
    ]);

    const todayClass = liveClasses.find((item) => item.status === "LIVE") || liveClasses.find((item) => item.scheduledStart >= todayStart && item.scheduledStart < tomorrow) || null;
    const featuredClass = liveClasses[0] || null;
    const attendanceByDay = attendance.map((item) => ({
      date: item.date.toISOString().slice(0, 10),
      status: item.status,
      present: item.status === AttendanceStatus.PRESENT || item.status === AttendanceStatus.LATE,
    }));

    res.json({
      status: "success",
      data: {
        user: { id: student.id, fullName: student.fullName, avatarUrl: student.avatarUrl },
        greeting: `${greetingFor(now.getHours())}, ${student.fullName.split(" ")[0]}!`,
        subtitle: "Keep learning, keep growing.",
        featuredClass: featuredClass && {
          id: featuredClass.id,
          title: featuredClass.title,
          instructor: featuredClass.teacherName,
          scheduledStart: featuredClass.scheduledStart.toISOString(),
          scheduledEnd: featuredClass.scheduledEnd.toISOString(),
          isLive: featuredClass.status === "LIVE",
          joinPath: `/student/classes/room/${featuredClass.id}`,
        },
        todayLiveClass: todayClass && {
          id: todayClass.id,
          title: todayClass.title,
          instructor: todayClass.teacherName,
          scheduledStart: todayClass.scheduledStart.toISOString(),
          scheduledEnd: todayClass.scheduledEnd.toISOString(),
          isLive: todayClass.status === "LIVE",
          joinPath: `/student/classes/room/${todayClass.id}`,
        },
        attendance: { month: range.start.toISOString().slice(0, 7), days: attendanceByDay },
        assignments: assignments.map((assignment) => {
          const submission = assignment.submissions[0] || null;
          return {
            id: assignment.id,
            title: assignment.title,
            description: assignment.description,
            type: assignment.typeTag,
            dueDate: assignment.dueDate.toISOString(),
            status: submission?.status || "PENDING",
            grade: submission?.grade || null,
            feedback: submission?.feedback || null,
            submissionId: submission?.id || null,
          };
        }),
        assignmentCount,
      },
    });
  } catch (error) {
    console.error("Get mobile dashboard error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch mobile dashboard." });
  }
};
