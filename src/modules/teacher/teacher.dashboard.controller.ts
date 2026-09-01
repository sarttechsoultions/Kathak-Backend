import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

function timeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return "Just now";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatClassTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatStartsIn(scheduledStart: Date): string {
  const diffMs = scheduledStart.getTime() - Date.now();
  if (diffMs <= 0) return "Starting now";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `Starts in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Starts in ${hrs}h`;
  return `Starts in ${Math.floor(hrs / 24)}d`;
}

function startOfDay(d = new Date()): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(d = new Date()): Date {
  const copy = new Date(d);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

export const getTeacherDashboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const teacherId = req.user!.id;

    const teacher = await prisma.user.findUnique({
      where: { id: teacherId },
      select: { fullName: true, avatarUrl: true },
    });

    const teacherBatches = await prisma.batch.findMany({
      where: { teacherId },
      select: {
        id: true,
        name: true,
        code: true,
        courseId: true,
        courseName: true,
        totalStudents: true,
      },
    });

    const batchIds = teacherBatches.map((b) => b.id);
    const batchNames = teacherBatches.map((b) => b.name);

    if (batchIds.length === 0) {
      res.json({
        status: "success",
        data: {
          teacherName: teacher?.fullName || "Teacher",
          stats: {
            totalStudents: 0,
            todaysClasses: 0,
            pendingReviews: 0,
            totalCourses: 0,
            attendanceRate: "—",
          },
          schedules: [],
          submissions: [],
          announcement: null,
          attendanceNote: "No batches assigned yet.",
        },
      });
      return;
    }

    const todayStart = startOfDay();
    const todayEnd = endOfDay();

    const [
      batchStudentRows,
      todayClasses,
      assignmentPendingCount,
      videoPendingCount,
      recentAssignmentSubs,
      recentVideoSubs,
      todayAttendanceTotal,
      todayAttendancePresent,
      allAttendanceTotal,
      allAttendancePresent,
      latestNotification,
      featuredEvent,
      batchStudentCounts,
    ] = await Promise.all([
      prisma.batchStudent.findMany({
        where: { batchId: { in: batchIds } },
        select: { studentId: true },
      }),
      prisma.liveClass.findMany({
        where: {
          batchId: { in: batchIds },
          scheduledStart: { gte: todayStart, lte: todayEnd },
        },
        include: {
          batch: { select: { name: true, code: true, totalStudents: true } },
        },
        orderBy: { scheduledStart: "asc" },
      }),
      prisma.assignmentSubmission.count({
        where: {
          status: "SUBMITTED",
          assignment: {
            OR: [{ teacherId }, { batchId: { in: batchIds } }],
          },
        },
      }),
      prisma.videoSubmission.count({
        where: {
          status: "PENDING",
          OR: [
            { task: { batchId: { in: batchIds } } },
            { task: { createdById: teacherId } },
            ...(batchNames.length
              ? [{ studentBatch: { in: batchNames } }]
              : []),
          ],
        },
      }),
      prisma.assignmentSubmission.findMany({
        where: {
          status: "SUBMITTED",
          assignment: {
            OR: [{ teacherId }, { batchId: { in: batchIds } }],
          },
        },
        include: {
          assignment: { select: { title: true } },
          student: { select: { avatarUrl: true } },
        },
        orderBy: { submittedAt: "desc" },
        take: 5,
      }),
      prisma.videoSubmission.findMany({
        where: {
          status: "PENDING",
          OR: [
            { task: { batchId: { in: batchIds } } },
            { task: { createdById: teacherId } },
          ],
        },
        orderBy: { submissionDate: "desc" },
        take: 5,
      }),
      prisma.attendance.count({
        where: { batchId: { in: batchIds }, date: { gte: todayStart, lte: todayEnd } },
      }),
      prisma.attendance.count({
        where: {
          batchId: { in: batchIds },
          date: { gte: todayStart, lte: todayEnd },
          status: "PRESENT",
        },
      }),
      prisma.attendance.count({ where: { batchId: { in: batchIds } } }),
      prisma.attendance.count({
        where: { batchId: { in: batchIds }, status: "PRESENT" },
      }),
      prisma.notification.findFirst({
        where: { userId: teacherId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.event.findFirst({
        where: {
          status: { in: ["SCHEDULED", "LIVE"] },
          OR: [{ isFeatured: true }, { leadInstructorId: teacherId }],
        },
        orderBy: { startDate: "asc" },
      }),
      prisma.batchStudent.groupBy({
        by: ["batchId"],
        where: { batchId: { in: batchIds } },
        _count: { studentId: true },
      }),
    ]);

    const uniqueStudentCount = new Set(batchStudentRows.map((r) => r.studentId)).size;
    const courseKeys = new Set(
      teacherBatches.map((b) => b.courseId || b.courseName).filter(Boolean)
    );

    const studentCountByBatch = new Map(
      batchStudentCounts.map((row) => [row.batchId, row._count.studentId])
    );

    const schedules = todayClasses.map((cls) => {
      const studentsCount =
        studentCountByBatch.get(cls.batchId) ??
        cls.batch?.totalStudents ??
        0;
      const isLive = cls.status === "LIVE";
      return {
        id: cls.id,
        time: formatClassTime(new Date(cls.scheduledStart)),
        title: cls.title,
        batchInfo: cls.batch?.name || cls.batch?.code || "Batch",
        studentsCount,
        status: isLive ? ("LIVE" as const) : ("UPCOMING" as const),
        startsIn: isLive ? undefined : formatStartsIn(new Date(cls.scheduledStart)),
        roomPath: `/teacher/live-classes/room/${cls.id}`,
      };
    });

    const assignmentSubmissionItems = recentAssignmentSubs.map((sub) => ({
      id: sub.id,
      studentName: sub.studentName,
      avatar: sub.student?.avatarUrl || "/Ananya.png",
      topic: sub.assignment?.title || "Assignment submission",
      timeAgo: timeAgo(new Date(sub.submittedAt)),
      href: "/teacher/assignments",
      sortTime: new Date(sub.submittedAt).getTime(),
    }));

    const videoSubmissionItems = recentVideoSubs.map((sub) => ({
      id: sub.id,
      studentName: sub.studentName,
      avatar: sub.studentAvatar || "/Ananya.png",
      topic: sub.videoTitle || "Video submission",
      timeAgo: timeAgo(new Date(sub.submissionDate)),
      href: "/teacher/video",
      sortTime: new Date(sub.submissionDate).getTime(),
    }));

    const submissions = [...assignmentSubmissionItems, ...videoSubmissionItems]
      .sort((a, b) => b.sortTime - a.sortTime)
      .slice(0, 5)
      .map(({ sortTime: _sortTime, ...rest }) => rest);

    let attendanceRate = "—";
    let attendanceNote = "No attendance recorded yet for your batches.";
    if (todayAttendanceTotal > 0) {
      attendanceRate = `${Math.round((todayAttendancePresent / todayAttendanceTotal) * 100)}%`;
      attendanceNote = "Average attendance across today's sessions in your batches.";
    } else if (allAttendanceTotal > 0) {
      attendanceRate = `${Math.round((allAttendancePresent / allAttendanceTotal) * 100)}%`;
      attendanceNote = "Overall attendance rate across your assigned batches.";
    }

    let announcement: {
      title: string;
      message: string;
      link?: string | null;
      label?: string;
    } | null = null;

    if (latestNotification) {
      announcement = {
        title: latestNotification.title,
        message: latestNotification.message,
        link: latestNotification.link,
        label: "View Details",
      };
    } else if (featuredEvent) {
      announcement = {
        title: featuredEvent.title,
        message: featuredEvent.description?.slice(0, 180) || "Upcoming academy event.",
        link: "/teacher/dashboard",
        label: "Learn More",
      };
    }

    res.json({
      status: "success",
      data: {
        teacherName: teacher?.fullName || "Teacher",
        stats: {
          totalStudents: uniqueStudentCount,
          todaysClasses: todayClasses.length,
          pendingReviews: assignmentPendingCount + videoPendingCount,
          totalCourses: courseKeys.size,
          attendanceRate,
        },
        schedules,
        submissions,
        announcement,
        attendanceNote,
      },
    });
  } catch (error) {
    console.error("Teacher Dashboard Error:", error);
    res.status(500).json({ status: "error", message: "Failed to load teacher dashboard." });
  }
};
