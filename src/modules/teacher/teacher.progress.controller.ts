import { Role } from "@prisma/client";
import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

type BatchScope = {
  id: string;
  name: string;
  code: string;
  courseName?: string | null;
  level?: string | null;
};

function batchAssignmentFilter(batch: BatchScope) {
  return {
    OR: [{ batchId: batch.id }, { batchName: batch.name }, { batchName: batch.code }],
  };
}

function batchVideoTaskFilter(batch: BatchScope) {
  return {
    OR: [{ batchId: batch.id }, { batchName: batch.name }, { batchName: batch.code }],
  };
}

function formatStudentCode(studentId: string): string {
  return `STU-${studentId.slice(0, 4).toUpperCase()}`;
}

function progressColor(progress: number): string {
  if (progress >= 85) return "text-[#A42E30]";
  if (progress >= 60) return "text-[#0EA5E9]";
  return "text-[#D97706]";
}

async function getAssignedBatchesForTeacher(teacherId: string, role?: Role) {
  const include = {
    course: { select: { title: true } },
  } as const;

  if (role === Role.ADMIN) {
    return prisma.batch.findMany({ include, orderBy: { createdAt: "desc" } });
  }

  const [byTeacherId, teacher] = await Promise.all([
    prisma.batch.findMany({ where: { teacherId }, include, orderBy: { createdAt: "desc" } }),
    prisma.user.findUnique({
      where: { id: teacherId },
      select: { batchesAsTeacher: { include } },
    }),
  ]);

  const batchMap = new Map<string, (typeof byTeacherId)[number]>();
  for (const batch of byTeacherId) batchMap.set(batch.id, batch);
  for (const batch of teacher?.batchesAsTeacher || []) batchMap.set(batch.id, batch);

  return Array.from(batchMap.values()).sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
}

async function teacherOwnsBatch(
  teacherId: string,
  batch: { id: string; teacherId: string | null },
  role?: Role
): Promise<boolean> {
  if (role === Role.ADMIN) return true;
  if (batch.teacherId && batch.teacherId === teacherId) return true;

  const linked = await prisma.user.findFirst({
    where: {
      id: teacherId,
      batchesAsTeacher: { some: { id: batch.id } },
    },
    select: { id: true },
  });

  return Boolean(linked);
}

async function computeStudentProgressMetrics(studentId: string, batch: BatchScope) {
  const assignmentFilter = batchAssignmentFilter(batch);
  const videoTaskFilter = batchVideoTaskFilter(batch);

  const [
    totalAssignments,
    assignmentSubmissions,
    totalExams,
    examResults,
    totalVideoTasks,
    videoSubmissions,
    attendanceRecords,
  ] = await Promise.all([
    prisma.assignment.count({ where: assignmentFilter }),
    prisma.assignmentSubmission.findMany({
      where: { studentId, assignment: assignmentFilter },
      include: { assignment: true },
      orderBy: { submittedAt: "desc" },
    }),
    prisma.exam.count({ where: { batchId: batch.id } }),
    prisma.examResult.findMany({
      where: { studentId, exam: { batchId: batch.id } },
      include: { exam: true },
      orderBy: { submittedAt: "desc" },
    }),
    prisma.videoTask.count({ where: videoTaskFilter }),
    prisma.videoSubmission.findMany({
      where: {
        studentId,
        OR: [
          { studentBatch: batch.name },
          { studentBatch: batch.code },
          { courseAndBatch: { contains: batch.code } },
          { courseAndBatch: { contains: batch.name } },
        ],
      },
      include: { task: true },
      orderBy: { submissionDate: "desc" },
    }),
    prisma.attendance.findMany({ where: { studentId, batchId: batch.id } }),
  ]);

  const examsTaken = examResults.filter(
    (result) => result.status !== "PENDING" && result.marksObtained !== null
  ).length;
  const assignmentsSubmitted = assignmentSubmissions.length;
  const videoSubmitted = videoSubmissions.length;

  let presentCount = 0;
  attendanceRecords.forEach((record) => {
    if (record.status === "PRESENT" || record.status === "LATE") presentCount++;
  });
  const attendanceRate =
    attendanceRecords.length > 0
      ? Math.round((presentCount / attendanceRecords.length) * 100)
      : 100;

  let totalAssignmentMarks = 0;
  let gradedAssignments = 0;
  assignmentSubmissions.forEach((submission) => {
    if (submission.status === "GRADED" && submission.grade) {
      gradedAssignments++;
      totalAssignmentMarks += Number(submission.grade) || 0;
    }
  });
  const avgAssignmentScore =
    gradedAssignments > 0 ? Math.round(totalAssignmentMarks / gradedAssignments) : 0;

  const completionRates: number[] = [];
  if (totalExams > 0) completionRates.push(examsTaken / totalExams);
  if (totalAssignments > 0) completionRates.push(assignmentsSubmitted / totalAssignments);
  if (totalVideoTasks > 0) completionRates.push(videoSubmitted / totalVideoTasks);

  const taskCompletionRate =
    completionRates.length > 0
      ? Math.round(
          (completionRates.reduce((sum, rate) => sum + rate, 0) / completionRates.length) * 100
        )
      : 100;

  let overallProgress = 0;
  if (gradedAssignments > 0) {
    overallProgress = Math.round(
      attendanceRate * 0.3 + taskCompletionRate * 0.3 + avgAssignmentScore * 0.4
    );
  } else {
    overallProgress = Math.round(attendanceRate * 0.5 + taskCompletionRate * 0.5);
  }
  overallProgress = Math.min(100, Math.max(0, overallProgress));

  const gradedExamScores = examResults
    .filter((result) => result.marksObtained !== null && result.exam.totalMarks > 0)
    .map((result) => (Number(result.marksObtained) / Number(result.exam.totalMarks)) * 10);

  const gradedVideoScores = videoSubmissions
    .filter((submission) => submission.marks !== null)
    .map((submission) => Number(submission.marks));

  return {
    examsTaken: `${examsTaken}/${totalExams}`,
    assignments: `${assignmentsSubmitted}/${totalAssignments}`,
    videoTasks: `${videoSubmitted}/${totalVideoTasks}`,
    overallProgress,
    progressColor: progressColor(overallProgress),
    attendanceRate,
    avgAssignmentScore,
    taskCompletionRate,
    assignmentSubmissions,
    examResults,
    videoSubmissions,
    gradedExamScores,
    gradedVideoScores,
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

export const getTeacherProgressHub = async (req: Request, res: Response): Promise<void> => {
  try {
    const teacherId = req.user!.id;
    const batchId = typeof req.query.batchId === "string" ? req.query.batchId : "";

    const assignedBatches = await getAssignedBatchesForTeacher(teacherId, req.user!.role);
    const scopedBatches = batchId
      ? assignedBatches.filter((batch) => batch.id === batchId)
      : assignedBatches;

    if (batchId && scopedBatches.length === 0) {
      res.status(403).json({ status: "error", message: "You do not have access to this batch." });
      return;
    }

    const batchOptions = assignedBatches.map((batch) => ({
      id: batch.id,
      name: batch.name,
      code: batch.code,
      label: `${batch.courseName || batch.course?.title || "Course"} — ${batch.name}`,
    }));

    const studentRows = await prisma.batchStudent.findMany({
      where: { batchId: { in: scopedBatches.map((batch) => batch.id) } },
      include: {
        student: {
          select: {
            id: true,
            fullName: true,
            email: true,
            avatarUrl: true,
          },
        },
        batch: {
          select: {
            id: true,
            name: true,
            code: true,
            courseName: true,
            level: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const uniqueStudents = new Map<
      string,
      {
        student: (typeof studentRows)[number]["student"];
        batch: (typeof studentRows)[number]["batch"];
      }
    >();

    for (const row of studentRows) {
      if (!uniqueStudents.has(row.studentId)) {
        uniqueStudents.set(row.studentId, { student: row.student, batch: row.batch });
      }
    }

    const students = await Promise.all(
      Array.from(uniqueStudents.entries()).map(async ([studentId, entry]) => {
        const metrics = await computeStudentProgressMetrics(studentId, {
          id: entry.batch.id,
          name: entry.batch.name,
          code: entry.batch.code,
          courseName: entry.batch.courseName,
          level: entry.batch.level,
        });

        return {
          id: studentId,
          name: entry.student.fullName,
          email: entry.student.email,
          avatarUrl: entry.student.avatarUrl,
          studentIdCode: formatStudentCode(studentId),
          level: entry.batch.level || entry.batch.courseName || "Kathak Student",
          batchId: entry.batch.id,
          batchName: entry.batch.name,
          exams: metrics.examsTaken,
          assignments: metrics.assignments,
          video: metrics.videoTasks,
          progress: `${metrics.overallProgress}%`,
          progressPercent: metrics.overallProgress,
          progressColor: metrics.progressColor,
          attendanceRate: metrics.attendanceRate,
          avgAssignmentScore: metrics.avgAssignmentScore,
          gradedExamScores: metrics.gradedExamScores,
          gradedVideoScores: metrics.gradedVideoScores,
        };
      })
    );

    students.sort((a, b) => b.progressPercent - a.progressPercent);

    const totalStudents = students.length;
    const avgAttendance =
      totalStudents > 0
        ? Number(
            (
              students.reduce((sum, student) => sum + student.attendanceRate, 0) / totalStudents
            ).toFixed(1)
          )
        : 0;
    const avgPerformance =
      totalStudents > 0
        ? Number(
            (
              students.reduce((sum, student) => sum + student.progressPercent, 0) /
              totalStudents /
              10
            ).toFixed(1)
          )
        : 0;

    const pendingAssignmentReviews = await prisma.assignmentSubmission.count({
      where: {
        status: "SUBMITTED",
        studentId: { in: students.map((student) => student.id) },
        assignment: {
          OR: scopedBatches.flatMap((batch) => [
            { batchId: batch.id },
            { batchName: batch.name },
            { batchName: batch.code },
          ]),
        },
      },
    });

    const pendingVideoReviews = await prisma.videoSubmission.count({
      where: {
        status: "PENDING",
        studentId: { in: students.map((student) => student.id) },
      },
    });

    const recentAssignmentSubs = await prisma.assignmentSubmission.findMany({
      where: {
        studentId: { in: students.map((student) => student.id) },
        assignment: {
          OR: scopedBatches.flatMap((batch) => [
            { batchId: batch.id },
            { batchName: batch.name },
            { batchName: batch.code },
          ]),
        },
      },
      include: {
        assignment: { select: { title: true } },
        student: { select: { fullName: true } },
      },
      orderBy: { submittedAt: "desc" },
      take: 5,
    });

    const recentVideoSubs = await prisma.videoSubmission.findMany({
      where: { studentId: { in: students.map((student) => student.id) } },
      orderBy: { submissionDate: "desc" },
      take: 5,
    });

    const recentSubmissions = [
      ...recentAssignmentSubs.map((submission) => ({
        id: submission.id,
        type: "assignment" as const,
        title: submission.assignment.title,
        studentName: submission.student.fullName,
        submittedAt: submission.submittedAt.toISOString(),
      })),
      ...recentVideoSubs.map((submission) => ({
        id: submission.id,
        type: "video" as const,
        title: submission.videoTitle,
        studentName: submission.studentName,
        submittedAt: submission.submissionDate.toISOString(),
      })),
    ]
      .sort(
        (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
      )
      .slice(0, 5);

    const allExamScores = students.flatMap((student) => student.gradedExamScores);
    const allVideoScores = students.flatMap((student) => student.gradedVideoScores);
    const allAssignmentScores = students
      .filter((student) => student.avgAssignmentScore > 0)
      .map((student) => student.avgAssignmentScore / 10);

    res.json({
      status: "success",
      data: {
        selectedBatchId: batchId || null,
        batches: batchOptions,
        summary: {
          totalStudents,
          avgAttendance,
          avgPerformance,
          pendingReviews: pendingAssignmentReviews + pendingVideoReviews,
        },
        skillBreakdown: {
          abhinaya: average(allVideoScores),
          nritta: average(allExamScores),
          mudras: average(allAssignmentScores),
          rhythm: average([
            ...allVideoScores,
            ...allExamScores,
            ...allAssignmentScores,
          ]),
        },
        students,
        recentSubmissions,
      },
    });
  } catch (error) {
    console.error("Get Teacher Progress Hub Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch student progress hub." });
  }
};

export const getTeacherStudentProgress = async (req: Request, res: Response): Promise<void> => {
  try {
    const teacherId = req.user!.id;
    const studentId = String(req.params.studentId);
    const batchId = typeof req.query.batchId === "string" ? req.query.batchId : "";

    const assignedBatches = await getAssignedBatchesForTeacher(teacherId, req.user!.role);
    const scopedBatchIds = batchId
      ? assignedBatches.filter((batch) => batch.id === batchId).map((batch) => batch.id)
      : assignedBatches.map((batch) => batch.id);

    if (scopedBatchIds.length === 0) {
      res.status(404).json({ status: "error", message: "Student not found in your batches." });
      return;
    }

    const membership = await prisma.batchStudent.findFirst({
      where: {
        studentId,
        batchId: { in: scopedBatchIds },
      },
      include: {
        student: {
          select: {
            id: true,
            fullName: true,
            email: true,
            avatarUrl: true,
            createdAt: true,
          },
        },
        batch: {
          select: {
            id: true,
            name: true,
            code: true,
            courseName: true,
            level: true,
            teacherId: true,
          },
        },
      },
    });

    if (!membership) {
      res.status(404).json({ status: "error", message: "Student not found in your batches." });
      return;
    }

    const allowed = await teacherOwnsBatch(teacherId, membership.batch, req.user!.role);
    if (!allowed) {
      res.status(403).json({ status: "error", message: "You do not have access to this student." });
      return;
    }

    const batchScope: BatchScope = {
      id: membership.batch.id,
      name: membership.batch.name,
      code: membership.batch.code,
      courseName: membership.batch.courseName,
      level: membership.batch.level,
    };

    const metrics = await computeStudentProgressMetrics(studentId, batchScope);

    res.json({
      status: "success",
      data: {
        student: {
          id: membership.student.id,
          name: membership.student.fullName,
          email: membership.student.email,
          avatarUrl: membership.student.avatarUrl,
          studentIdCode: formatStudentCode(membership.student.id),
          courseName: membership.batch.courseName || "Kathak Course",
          batchName: membership.batch.name,
          level: membership.batch.level || "Student",
          joinedAt: membership.student.createdAt.toISOString(),
        },
        metrics: {
          overallProgress: metrics.overallProgress,
          attendanceRate: metrics.attendanceRate,
          taskCompletionRate: metrics.taskCompletionRate,
          avgAssignmentScore: metrics.avgAssignmentScore,
        },
        exams: metrics.examResults.map((result) => ({
          id: result.id,
          title: result.exam.title,
          date: result.exam.date.toISOString(),
          maxMarks: result.exam.totalMarks,
          obtained: result.marksObtained,
          status: result.status,
        })),
        assignments: metrics.assignmentSubmissions.map((submission) => ({
          id: submission.id,
          assignmentId: submission.assignmentId,
          title: submission.assignment.title,
          submittedAt: submission.submittedAt.toISOString(),
          status: submission.status,
          marks: submission.grade || null,
          totalMarks: submission.assignment.totalPoints,
        })),
        videoTasks: metrics.videoSubmissions.map((submission) => ({
          id: submission.id,
          title: submission.videoTitle || submission.task?.title || "Video Task",
          submittedAt: submission.submissionDate.toISOString(),
          status: submission.status,
          marks: submission.marks,
          totalMarks: 10,
        })),
      },
    });
  } catch (error) {
    console.error("Get Teacher Student Progress Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch student progress." });
  }
};
