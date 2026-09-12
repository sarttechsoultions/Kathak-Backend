import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { Role, PaymentStatus, AttendanceStatus } from "@prisma/client";
import { generatePdfBuffer } from "../../lib/invoice";
import { BUSINESS_DETAILS } from "../../lib/businessConfig";

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const displayId = (uuid: string) => `STU-${uuid.slice(-4).toUpperCase()}`;

const pct = (num: number, den: number) =>
  den === 0 ? null : Math.round((num / den) * 100);

const fmtDate = (d: Date | string | null | undefined) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

/**
 * Overall Progress Calculation
 * ─────────────────────────────────────────────────────────────────
 * Categories and their base weights:
 *   Attendance:  30  → (present + late) / total attendance records
 *   Assignments: 30  → submitted (SUBMITTED + GRADED) / total for batches
 *   Exams:       25  → avg(marks_obtained / total_marks) across all results
 *   Fee Status:  15  → paid dues / total dues
 *
 * If a category has zero data points its weight is excluded and the
 * remaining weights are re-normalised to sum to 100%.
 */
function calculateOverallProgress(components: {
  attendancePct: number | null;
  assignmentPct: number | null;
  examPct: number | null;
  feePct: number | null;
}): number {
  const entries: { value: number; weight: number }[] = [];

  if (components.attendancePct !== null)
    entries.push({ value: components.attendancePct, weight: 30 });
  if (components.assignmentPct !== null)
    entries.push({ value: components.assignmentPct, weight: 30 });
  if (components.examPct !== null)
    entries.push({ value: components.examPct, weight: 25 });
  if (components.feePct !== null)
    entries.push({ value: components.feePct, weight: 15 });

  if (entries.length === 0) return 0;

  const totalWeight = entries.reduce((s, e) => s + e.weight, 0);
  const weighted = entries.reduce(
    (s, e) => s + (e.value * e.weight) / totalWeight,
    0
  );
  return Math.round(weighted);
}

// ─────────────────────────────────────────────────────────────────────
// 1. GET /api/v1/admin/student-reports
//    Paginated student list with progress data + summary cards
// ─────────────────────────────────────────────────────────────────────
export const getStudentReports = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    // ── Parse query params ──
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit as string) || 15)
    );
    const search = ((req.query.search as string) || "").trim();
    const courseId = (req.query.courseId as string) || "";
    const batchId = (req.query.batchId as string) || "";
    const status = (req.query.status as string) || ""; // Active | Inactive | Completed
    const dateFrom = req.query.dateFrom
      ? new Date(req.query.dateFrom as string)
      : null;
    const dateTo = req.query.dateTo
      ? new Date(req.query.dateTo as string)
      : null;

    // ── Build Prisma where clause ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { role: Role.STUDENT };

    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { id: { contains: search, mode: "insensitive" } },
      ];
    }

    if (status === "Active") where.isActive = true;
    else if (status === "Inactive") where.isActive = false;
    else if (status === "Completed") {
      // "Completed" = has at least one enrollment that is no longer active
      where.enrollments = { some: { active: false } };
    }

    if (courseId) {
      where.enrollments = {
        ...where.enrollments,
        some: { ...(where.enrollments?.some || {}), courseId },
      };
    }

    if (batchId) {
      where.batchMemberships = { some: { batchId } };
    }

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = dateFrom;
      if (dateTo) {
        const endOfDay = new Date(dateTo);
        endOfDay.setHours(23, 59, 59, 999);
        where.createdAt.lte = endOfDay;
      }
    }

    // ── Summary cards (independent of pagination) ──
    const [
      totalStudents,
      activeStudents,
      pendingFeesResult,
      attendanceAgg,
    ] = await Promise.all([
      prisma.user.count({ where: { role: Role.STUDENT } }),
      prisma.user.count({ where: { role: Role.STUDENT, isActive: true } }),
      prisma.monthlyDue.findMany({
        where: { status: PaymentStatus.PENDING },
        select: { userId: true },
        distinct: ["userId"],
      }),
      prisma.attendance.groupBy({
        by: ["status"],
        _count: { id: true },
      }),
    ]);

    const studentsWithPendingFees = pendingFeesResult.length;

    const totalAttRecords = attendanceAgg.reduce(
      (s, r) => s + r._count.id,
      0
    );
    const presentAttRecords = attendanceAgg
      .filter(
        (r) =>
          r.status === AttendanceStatus.PRESENT ||
          r.status === AttendanceStatus.LATE
      )
      .reduce((s, r) => s + r._count.id, 0);
    const averageAttendance =
      totalAttRecords > 0
        ? Math.round((presentAttRecords / totalAttRecords) * 100)
        : 0;

    // ── Paginated students with includes ──
    const [students, totalCount] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          enrollments: {
            include: { course: { select: { id: true, title: true } } },
            orderBy: { createdAt: "desc" },
          },
          batchMemberships: {
            include: {
              batch: {
                select: { id: true, name: true, courseId: true },
              },
            },
          },
          attendances: {
            select: { status: true, date: true },
            ...(dateFrom || dateTo
              ? {
                  where: {
                    date: {
                      ...(dateFrom ? { gte: dateFrom } : {}),
                      ...(dateTo
                        ? {
                            lte: (() => {
                              const d = new Date(dateTo);
                              d.setHours(23, 59, 59, 999);
                              return d;
                            })(),
                          }
                        : {}),
                    },
                  },
                }
              : {}),
          },
          assignmentSubmissions: {
            select: { status: true },
          },
          examResults: {
            select: { marksObtained: true, exam: { select: { totalMarks: true } } },
            orderBy: { submittedAt: "desc" },
          },
          monthlyDues: {
            select: { status: true, dueDate: true, amount: true },
            orderBy: { dueDate: "desc" },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    // ── Collect all batch IDs for these students to compute total assignments ──
    const allBatchIds = new Set<string>();
    students.forEach((s) =>
      s.batchMemberships.forEach((m) => allBatchIds.add(m.batchId))
    );

    // Count total assignments per batch (single query, prevents N+1)
    const batchAssignmentCounts = await prisma.assignment.groupBy({
      by: ["batchId"],
      where: { batchId: { in: Array.from(allBatchIds) } },
      _count: { id: true },
    });
    const batchAssignmentMap = new Map<string, number>();
    batchAssignmentCounts.forEach((r) => {
      if (r.batchId) batchAssignmentMap.set(r.batchId, r._count.id);
    });

    // ── Map each student to a report row ──
    const rows = students.map((student) => {
      const enrollment = student.enrollments[0] || null;
      const batch = student.batchMemberships[0]?.batch || null;

      // Attendance
      const totalAtt = student.attendances.length;
      const presentAtt = student.attendances.filter(
        (a) =>
          a.status === AttendanceStatus.PRESENT ||
          a.status === AttendanceStatus.LATE
      ).length;
      const attendancePct = pct(presentAtt, totalAtt);

      // Assignments
      const studentBatchIds = student.batchMemberships.map((m) => m.batchId);
      const totalAssignments = studentBatchIds.reduce(
        (sum, bid) => sum + (batchAssignmentMap.get(bid) || 0),
        0
      );
      const completedAssignments = student.assignmentSubmissions.filter(
        (s) => s.status === "SUBMITTED" || s.status === "GRADED"
      ).length;
      const pendingAssignments = Math.max(
        0,
        totalAssignments - completedAssignments
      );
      const assignmentPct = pct(completedAssignments, totalAssignments);

      // Exams
      const examResults = student.examResults.filter(
        (r) => r.marksObtained !== null
      );
      let examPct: number | null = null;
      if (examResults.length > 0) {
        const avgExamScore =
          examResults.reduce(
            (s, r) =>
              s +
              ((r.marksObtained ?? 0) / (r.exam.totalMarks || 100)) * 100,
            0
          ) / examResults.length;
        examPct = Math.round(avgExamScore);
      }
      const latestExamScore =
        examResults.length > 0
          ? `${examResults[0].marksObtained}/${examResults[0].exam.totalMarks}`
          : null;

      // Fee status
      const totalDues = student.monthlyDues.length;
      const paidDues = student.monthlyDues.filter(
        (d) => d.status === PaymentStatus.SUCCESS
      ).length;
      const pendingDues = student.monthlyDues.filter(
        (d) => d.status === PaymentStatus.PENDING
      );
      const feePct = pct(paidDues, totalDues);

      let feeStatus: "Paid" | "Pending" | "Overdue" | "N/A" = "N/A";
      if (totalDues > 0) {
        const hasOverdue = pendingDues.some(
          (d) => new Date(d.dueDate) < new Date()
        );
        if (hasOverdue) feeStatus = "Overdue";
        else if (pendingDues.length > 0) feeStatus = "Pending";
        else feeStatus = "Paid";
      }

      // Overall progress
      const overallProgress = calculateOverallProgress({
        attendancePct,
        assignmentPct,
        examPct,
        feePct,
      });

      return {
        id: student.id,
        displayId: displayId(student.id),
        name: student.fullName,
        email: student.email,
        avatarUrl: student.avatarUrl,
        course: enrollment?.course?.title || null,
        courseId: enrollment?.course?.id || null,
        batch: batch?.name || null,
        batchId: batch?.id || null,
        enrollmentDate: enrollment?.createdAt
          ? enrollment.createdAt.toISOString().split("T")[0]
          : student.createdAt.toISOString().split("T")[0],
        attendancePct,
        completedAssignments,
        pendingAssignments,
        latestExamScore,
        feeStatus,
        overallProgress,
        isActive: student.isActive,
      };
    });

    // ── Fetch dropdown options ──
    const [courses, batches] = await Promise.all([
      prisma.course.findMany({
        select: { id: true, title: true },
        where: { published: true },
        orderBy: { title: "asc" },
      }),
      prisma.batch.findMany({
        select: { id: true, name: true, courseId: true },
        where: { status: "Active" },
        orderBy: { name: "asc" },
      }),
    ]);

    res.json({
      status: "success",
      data: {
        summary: {
          totalStudents,
          activeStudents,
          studentsWithPendingFees,
          averageAttendance,
        },
        students: rows,
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit),
        },
        filters: { courses, batches },
      },
    });
  } catch (error) {
    console.error("Student Reports Error:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to fetch student reports.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────
// 2. GET /api/v1/admin/student-reports/:id
//    Detailed student progress for the drawer view
// ─────────────────────────────────────────────────────────────────────
export const getStudentReportDetail = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const studentId = req.params.id as string;

    const student = await prisma.user.findFirst({
      where: { id: studentId, role: Role.STUDENT },
      include: {
        enrollments: {
          include: { course: { select: { id: true, title: true, category: true } } },
          orderBy: { createdAt: "desc" },
        },
        batchMemberships: {
          include: {
            batch: {
              select: {
                id: true,
                name: true,
                code: true,
                courseName: true,
                schedule: true,
                teacherName: true,
              },
            },
          },
        },
        attendances: {
          select: { status: true, date: true, batchName: true, session: true },
          orderBy: { date: "desc" },
        },
        assignmentSubmissions: {
          include: {
            assignment: {
              select: { title: true, dueDate: true, totalPoints: true, batchId: true },
            },
          },
          orderBy: { submittedAt: "desc" },
        },
        examResults: {
          include: {
            exam: {
              select: {
                title: true,
                totalMarks: true,
                passingMarks: true,
                type: true,
                date: true,
              },
            },
          },
          orderBy: { submittedAt: "desc" },
        },
        monthlyDues: {
          select: {
            dueMonth: true,
            dueDate: true,
            amount: true,
            status: true,
            paidAt: true,
            currency: true,
          },
          orderBy: { dueDate: "desc" },
        },
      },
    });

    if (!student) {
      res.status(404).json({
        status: "error",
        message: "Student not found.",
      });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = student as any;

    // ── Attendance summary ──
    const totalAttendance = (s.attendances || []).length;
    const attended = (s.attendances || []).filter(
      (a: any) =>
        a.status === AttendanceStatus.PRESENT ||
        a.status === AttendanceStatus.LATE
    ).length;
    const absent = (s.attendances || []).filter(
      (a: any) => a.status === AttendanceStatus.ABSENT
    ).length;
    const attendancePct = pct(attended, totalAttendance);

    // ── Assignments summary ──
    const studentBatchIds = (s.batchMemberships || []).map((m: any) => m.batchId);
    const totalAssignmentsForBatches = await prisma.assignment.count({
      where: { batchId: { in: studentBatchIds } },
    });
    const submitted = (s.assignmentSubmissions || []).filter(
      (sub: any) => sub.status === "SUBMITTED" || sub.status === "GRADED"
    ).length;
    const graded = (s.assignmentSubmissions || []).filter(
      (sub: any) => sub.status === "GRADED"
    ).length;
    const pendingAssignments = Math.max(
      0,
      totalAssignmentsForBatches - (s.assignmentSubmissions || []).length
    );
    const assignmentPct = pct(submitted, totalAssignmentsForBatches);

    // ── Exams summary ──
    const examResults = (s.examResults || [])
      .filter((r: any) => r.marksObtained !== null)
      .map((r: any) => ({
        examName: r.exam.title,
        type: r.exam.type,
        date: r.exam.date,
        marksObtained: r.marksObtained ?? 0,
        totalMarks: r.exam.totalMarks,
        percentage: pct(r.marksObtained ?? 0, r.exam.totalMarks) ?? 0,
        result:
          (r.marksObtained ?? 0) >= r.exam.passingMarks ? "PASS" : "FAIL",
        grade: r.grade,
      }));
    let examPct: number | null = null;
    if (examResults.length > 0) {
      examPct = Math.round(
        examResults.reduce((sum: number, r: any) => sum + r.percentage, 0) / examResults.length
      );
    }

    // ── Fee summary ──
    const totalDues = (s.monthlyDues || []).length;
    const paidDues = (s.monthlyDues || []).filter(
      (d: any) => d.status === PaymentStatus.SUCCESS
    );
    const pendingDuesArr = (s.monthlyDues || []).filter(
      (d: any) => d.status === PaymentStatus.PENDING
    );
    const paidAmount = paidDues.reduce((sum: number, d: any) => sum + d.amount, 0);
    const dueAmount = pendingDuesArr.reduce((sum: number, d: any) => sum + d.amount, 0);
    const nextDueDate =
      pendingDuesArr.length > 0
        ? pendingDuesArr[pendingDuesArr.length - 1].dueDate
        : null;
    const feePct = pct(paidDues.length, totalDues);

    // ── Recent class activity ──
    const recentClasses = await prisma.liveClass.findMany({
      where: {
        batchId: { in: studentBatchIds },
      },
      include: {
        attendance: {
          where: { studentId },
          select: { status: true },
          take: 1,
        },
      },
      orderBy: { scheduledStart: "desc" },
      take: 10,
    });

    const recentActivity = recentClasses.map((c: any) => ({
      title: c.title,
      date: c.scheduledStart,
      classStatus: c.status,
      attended:
        c.attendance.length > 0
          ? c.attendance[0].status === AttendanceStatus.PRESENT ||
            c.attendance[0].status === AttendanceStatus.LATE
          : null,
    }));

    // ── Overall progress ──
    const overallProgress = calculateOverallProgress({
      attendancePct,
      assignmentPct,
      examPct,
      feePct,
    });

    res.json({
      status: "success",
      data: {
        profile: {
          displayId: displayId(student.id),
          name: student.fullName,
          email: student.email,
          phone: student.phone,
          avatarUrl: student.avatarUrl,
          country: student.country,
          joiningDate: student.joiningDate || student.createdAt,
          isActive: student.isActive,
        },
        courseAndBatch: {
          enrollments: (s.enrollments || []).map((e: any) => ({
            courseTitle: e.course.title,
            category: e.course.category,
            mode: e.mode,
            type: e.type,
            active: e.active,
            enrolledAt: e.createdAt,
          })),
          batches: (s.batchMemberships || []).map((m: any) => ({
            name: m.batch.name,
            code: m.batch.code,
            courseName: m.batch.courseName,
            schedule: m.batch.schedule,
            teacherName: m.batch.teacherName,
          })),
        },
        attendance: {
          total: totalAttendance,
          attended,
          absent,
          leave: totalAttendance - attended - absent,
          percentage: attendancePct ?? 0,
        },
        assignments: {
          total: totalAssignmentsForBatches,
          submitted,
          pending: pendingAssignments,
          graded,
          percentage: assignmentPct ?? 0,
          recent: (s.assignmentSubmissions || []).slice(0, 5).map((sub: any) => ({
            title: sub.assignment.title,
            status: sub.status,
            grade: sub.grade,
            submittedAt: sub.submittedAt,
          })),
        },
        exams: {
          results: examResults,
          averagePercentage: examPct ?? 0,
        },
        fees: {
          paidAmount,
          dueAmount,
          nextDueDate,
          currency: paidDues[0]?.currency || pendingDuesArr[0]?.currency || "INR",
          totalDues,
          paidCount: paidDues.length,
          pendingCount: pendingDuesArr.length,
        },
        recentActivity,
        overallProgress,
        progressBreakdown: {
          attendance: attendancePct,
          assignments: assignmentPct,
          exams: examPct,
          fees: feePct,
        },
      },
    });
  } catch (error) {
    console.error("Student Report Detail Error:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to fetch student report detail.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────
// 3. GET /api/v1/admin/student-reports/:id/pdf
//    Download a professional PDF report for one student
// ─────────────────────────────────────────────────────────────────────
export const downloadStudentReportPdf = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const studentId = req.params.id as string;

    const student = await prisma.user.findFirst({
      where: { id: studentId, role: Role.STUDENT },
      include: {
        enrollments: {
          include: { course: { select: { title: true, category: true } } },
          orderBy: { createdAt: "desc" },
        },
        batchMemberships: {
          include: {
            batch: {
              select: { name: true, code: true, courseName: true, schedule: true },
            },
          },
        },
        attendances: {
          select: { status: true },
        },
        assignmentSubmissions: {
          select: { status: true },
          },
        examResults: {
          include: {
            exam: {
              select: { title: true, totalMarks: true, passingMarks: true, type: true, date: true },
            },
          },
          orderBy: { submittedAt: "desc" },
        },
        monthlyDues: {
          select: { status: true, amount: true, dueDate: true, dueMonth: true },
          orderBy: { dueDate: "desc" },
        },
      },
    });

    if (!student) {
      res.status(404).json({ status: "error", message: "Student not found." });
      return;
    }
    // Cast to access included relations — matching the pattern in admin.controller.ts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = student as any;

    // ── Compute progress data ──
    const totalAtt = (s.attendances || []).length;
    const presentAtt = (s.attendances || []).filter(
      (a: any) => a.status === AttendanceStatus.PRESENT || a.status === AttendanceStatus.LATE
    ).length;
    const absentAtt = (s.attendances || []).filter(
      (a: any) => a.status === AttendanceStatus.ABSENT
    ).length;
    const attendancePct = pct(presentAtt, totalAtt);

    const studentBatchIds = (s.batchMemberships || []).map((m: any) => m.batchId);
    const totalAssignments = await prisma.assignment.count({
      where: { batchId: { in: studentBatchIds } },
    });
    const submittedAssignments = (s.assignmentSubmissions || []).filter(
      (sub: any) => sub.status === "SUBMITTED" || sub.status === "GRADED"
    ).length;
    const assignmentPct = pct(submittedAssignments, totalAssignments);

    const gradedExams = (s.examResults || []).filter((r: any) => r.marksObtained !== null);
    let examPct: number | null = null;
    if (gradedExams.length > 0) {
      examPct = Math.round(
        gradedExams.reduce(
          (sum: number, r: any) => sum + ((r.marksObtained ?? 0) / (r.exam.totalMarks || 100)) * 100,
          0
        ) / gradedExams.length
      );
    }

    const totalDues = (s.monthlyDues || []).length;
    const paidDues = (s.monthlyDues || []).filter((d: any) => d.status === PaymentStatus.SUCCESS);
    const pendingDuesArr = (s.monthlyDues || []).filter((d: any) => d.status === PaymentStatus.PENDING);
    const paidAmount = paidDues.reduce((sum: number, d: any) => sum + d.amount, 0);
    const dueAmount = pendingDuesArr.reduce((sum: number, d: any) => sum + d.amount, 0);
    const feePct = pct(paidDues.length, totalDues);

    const overallProgress = calculateOverallProgress({
      attendancePct,
      assignmentPct,
      examPct,
      feePct,
    });

    const enrollment = (s.enrollments || [])[0];
    const batch = (s.batchMemberships || [])[0]?.batch;

    // ── Build PDF HTML ──
    const html = buildStudentReportHtml({
      academyName: BUSINESS_DETAILS.tradeName,
      academyAddress: BUSINESS_DETAILS.address,
      reportDate: new Date(),
      student: {
        displayId: displayId(student.id),
        name: student.fullName,
        email: student.email,
        phone: student.phone,
        course: enrollment?.course?.title || "N/A",
        batch: batch?.name || "N/A",
        batchSchedule: batch?.schedule || "N/A",
        enrollmentDate: enrollment?.createdAt || student.createdAt,
      },
      attendance: {
        total: totalAtt,
        present: presentAtt,
        absent: absentAtt,
        leave: totalAtt - presentAtt - absentAtt,
        percentage: attendancePct ?? 0,
      },
      assignments: {
        total: totalAssignments,
        submitted: submittedAssignments,
        pending: Math.max(0, totalAssignments - submittedAssignments),
        percentage: assignmentPct ?? 0,
      },
      exams: gradedExams.map((r: any) => ({
        name: r.exam.title,
        type: r.exam.type,
        date: r.exam.date,
        marks: r.marksObtained ?? 0,
        totalMarks: r.exam.totalMarks,
        percentage: pct(r.marksObtained ?? 0, r.exam.totalMarks) ?? 0,
        result: (r.marksObtained ?? 0) >= r.exam.passingMarks ? "PASS" : "FAIL",
      })),
      fees: {
        paidAmount,
        dueAmount,
        totalDues,
        paidCount: paidDues.length,
        pendingCount: pendingDuesArr.length,
      },
      overallProgress,
      signatory: BUSINESS_DETAILS.authorizedSignatory,
    });

    const pdfBuffer = await generatePdfBuffer(html);

    const safeName = student.fullName.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_");
    const fileName = `Student_Report_${safeName}_${new Date().toISOString().split("T")[0]}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", pdfBuffer.length.toString());
    res.end(pdfBuffer);
  } catch (error) {
    console.error("Student Report PDF Error:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to generate student report PDF.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────
// PDF HTML Template Builder
// ─────────────────────────────────────────────────────────────────────
interface ReportData {
  academyName: string;
  academyAddress: string;
  reportDate: Date;
  student: {
    displayId: string;
    name: string;
    email: string;
    phone: string;
    course: string;
    batch: string;
    batchSchedule: string;
    enrollmentDate: Date;
  };
  attendance: {
    total: number;
    present: number;
    absent: number;
    leave: number;
    percentage: number;
  };
  assignments: {
    total: number;
    submitted: number;
    pending: number;
    percentage: number;
  };
  exams: {
    name: string;
    type: string;
    date: Date;
    marks: number;
    totalMarks: number;
    percentage: number;
    result: string;
  }[];
  fees: {
    paidAmount: number;
    dueAmount: number;
    totalDues: number;
    paidCount: number;
    pendingCount: number;
  };
  overallProgress: number;
  signatory: string;
}

const escapeHtml = (val: unknown) =>
  String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function buildStudentReportHtml(data: ReportData): string {
  const examRows = data.exams.length > 0
    ? data.exams
        .map(
          (e) => `
        <tr>
          <td>${escapeHtml(e.name)}</td>
          <td>${escapeHtml(e.type)}</td>
          <td>${fmtDate(e.date)}</td>
          <td>${e.marks} / ${e.totalMarks}</td>
          <td>${e.percentage}%</td>
          <td style="color: ${e.result === "PASS" ? "#16a34a" : "#dc2626"}; font-weight: 700;">${e.result}</td>
        </tr>`
        )
        .join("")
    : `<tr><td colspan="6" style="text-align:center; color: #94a3b8; padding: 16px;">No exam results available</td></tr>`;

  const feeStatus =
    data.fees.pendingCount > 0
      ? `<span style="color: #dc2626; font-weight: 700;">₹${data.fees.dueAmount.toLocaleString("en-IN")} Pending</span>`
      : `<span style="color: #16a34a; font-weight: 700;">All Dues Paid</span>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; color: #1c1917; font-size: 13px; line-height: 1.6; }
    .page { padding: 32px 40px; max-width: 800px; margin: 0 auto; }
    .header { text-align: center; border-bottom: 3px solid #9E0C25; padding-bottom: 16px; margin-bottom: 24px; }
    .header h1 { font-size: 20px; color: #9E0C25; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 4px; }
    .header p { font-size: 11px; color: #78716c; }
    .report-title { text-align: center; font-size: 16px; font-weight: 800; color: #292524; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 1px; }
    .report-date { text-align: center; font-size: 11px; color: #78716c; margin-bottom: 24px; }
    .section { margin-bottom: 22px; }
    .section-title { font-size: 13px; font-weight: 800; color: #9E0C25; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1.5px solid #e7e5e4; padding-bottom: 6px; margin-bottom: 12px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; }
    .info-item { display: flex; gap: 6px; }
    .info-label { font-weight: 700; color: #78716c; min-width: 120px; font-size: 12px; }
    .info-value { font-weight: 600; color: #292524; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { background: #fafaf9; color: #78716c; text-transform: uppercase; font-size: 10px; font-weight: 800; letter-spacing: 0.5px; padding: 8px 10px; text-align: left; border-bottom: 1.5px solid #e7e5e4; }
    td { padding: 7px 10px; border-bottom: 1px solid #f5f5f4; }
    tr:last-child td { border-bottom: none; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .summary-card { background: #fafaf9; border-radius: 8px; padding: 12px; text-align: center; border: 1px solid #e7e5e4; }
    .summary-card .value { font-size: 22px; font-weight: 800; color: #292524; }
    .summary-card .label { font-size: 10px; font-weight: 700; color: #78716c; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
    .progress-bar-outer { background: #e7e5e4; border-radius: 6px; height: 14px; margin-top: 8px; overflow: hidden; }
    .progress-bar-inner { background: linear-gradient(90deg, #9E0C25, #D94860); height: 100%; border-radius: 6px; transition: width 0.3s; }
    .progress-section { background: #fafaf9; border-radius: 10px; padding: 16px 20px; border: 1px solid #e7e5e4; text-align: center; }
    .progress-value { font-size: 28px; font-weight: 800; color: #9E0C25; }
    .signature-section { margin-top: 40px; display: flex; justify-content: space-between; align-items: flex-end; }
    .sig-block { text-align: center; }
    .sig-line { width: 180px; border-bottom: 1px solid #292524; margin-bottom: 6px; height: 40px; }
    .sig-label { font-size: 11px; color: #78716c; font-weight: 700; }
    .footer { margin-top: 28px; text-align: center; font-size: 10px; color: #a8a29e; border-top: 1px solid #e7e5e4; padding-top: 12px; }
  </style>
</head>
<body>
  <div class="page">
    <!-- Header -->
    <div class="header">
      <h1>${escapeHtml(data.academyName)}</h1>
      <p>${escapeHtml(data.academyAddress)}</p>
    </div>

    <div class="report-title">Student Progress Report</div>
    <div class="report-date">Generated on ${fmtDate(data.reportDate)}</div>

    <!-- Student Information -->
    <div class="section">
      <div class="section-title">Student Information</div>
      <div class="info-grid">
        <div class="info-item"><span class="info-label">Student ID:</span><span class="info-value">${escapeHtml(data.student.displayId)}</span></div>
        <div class="info-item"><span class="info-label">Student Name:</span><span class="info-value">${escapeHtml(data.student.name)}</span></div>
        <div class="info-item"><span class="info-label">Email:</span><span class="info-value">${escapeHtml(data.student.email)}</span></div>
        <div class="info-item"><span class="info-label">Phone:</span><span class="info-value">${escapeHtml(data.student.phone)}</span></div>
        <div class="info-item"><span class="info-label">Course:</span><span class="info-value">${escapeHtml(data.student.course)}</span></div>
        <div class="info-item"><span class="info-label">Batch:</span><span class="info-value">${escapeHtml(data.student.batch)}</span></div>
        <div class="info-item"><span class="info-label">Schedule:</span><span class="info-value">${escapeHtml(data.student.batchSchedule)}</span></div>
        <div class="info-item"><span class="info-label">Enrollment Date:</span><span class="info-value">${fmtDate(data.student.enrollmentDate)}</span></div>
      </div>
    </div>

    <!-- Attendance Report -->
    <div class="section">
      <div class="section-title">Attendance Report</div>
      <div class="summary-grid">
        <div class="summary-card"><div class="value">${data.attendance.total}</div><div class="label">Total Sessions</div></div>
        <div class="summary-card"><div class="value" style="color:#16a34a">${data.attendance.present}</div><div class="label">Present</div></div>
        <div class="summary-card"><div class="value" style="color:#dc2626">${data.attendance.absent}</div><div class="label">Absent</div></div>
        <div class="summary-card"><div class="value" style="color:#9E0C25">${data.attendance.percentage}%</div><div class="label">Attendance Rate</div></div>
      </div>
    </div>

    <!-- Assignment Report -->
    <div class="section">
      <div class="section-title">Assignment Report</div>
      <div class="summary-grid">
        <div class="summary-card"><div class="value">${data.assignments.total}</div><div class="label">Total Assignments</div></div>
        <div class="summary-card"><div class="value" style="color:#16a34a">${data.assignments.submitted}</div><div class="label">Submitted</div></div>
        <div class="summary-card"><div class="value" style="color:#f59e0b">${data.assignments.pending}</div><div class="label">Pending</div></div>
        <div class="summary-card"><div class="value" style="color:#9E0C25">${data.assignments.percentage}%</div><div class="label">Completion Rate</div></div>
      </div>
    </div>

    <!-- Exam Performance -->
    <div class="section">
      <div class="section-title">Exam Performance</div>
      <table>
        <thead>
          <tr><th>Exam Name</th><th>Type</th><th>Date</th><th>Marks</th><th>Percentage</th><th>Result</th></tr>
        </thead>
        <tbody>${examRows}</tbody>
      </table>
    </div>

    <!-- Fee Status -->
    <div class="section">
      <div class="section-title">Fee Status</div>
      <div class="info-grid">
        <div class="info-item"><span class="info-label">Total Dues:</span><span class="info-value">${data.fees.totalDues}</span></div>
        <div class="info-item"><span class="info-label">Paid:</span><span class="info-value">${data.fees.paidCount} (₹${data.fees.paidAmount.toLocaleString("en-IN")})</span></div>
        <div class="info-item"><span class="info-label">Pending:</span><span class="info-value">${data.fees.pendingCount}</span></div>
        <div class="info-item"><span class="info-label">Status:</span><span class="info-value">${feeStatus}</span></div>
      </div>
    </div>

    <!-- Overall Progress -->
    <div class="section">
      <div class="section-title">Overall Progress Summary</div>
      <div class="progress-section">
        <div class="progress-value">${data.overallProgress}%</div>
        <div style="font-size: 11px; color: #78716c; margin-top: 4px; font-weight: 600;">Overall Learning Progress</div>
        <div class="progress-bar-outer">
          <div class="progress-bar-inner" style="width: ${data.overallProgress}%"></div>
        </div>
      </div>
    </div>

    <!-- Signature Section -->
    <div class="signature-section">
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-label">Admin Signature</div>
      </div>
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-label">Admin Remarks</div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      This is a computer-generated report from ${escapeHtml(data.academyName)}. &copy; ${new Date().getFullYear()} All Rights Reserved.
    </div>
  </div>
</body>
</html>`;
}
