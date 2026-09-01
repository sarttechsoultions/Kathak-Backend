import { Role } from "@prisma/client";
import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { getBatchMaxCapacity } from "../../lib/batchHelpers";

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

async function getAssignedBatchesForTeacher(teacherId: string, role?: Role) {
  const include = {
    course: { select: { id: true, title: true } },
    _count: { select: { students: true } },
  } as const;

  if (role === Role.ADMIN) {
    return prisma.batch.findMany({
      include,
      orderBy: { createdAt: "desc" },
    });
  }

  const [byTeacherId, teacher] = await Promise.all([
    prisma.batch.findMany({
      where: { teacherId },
      include,
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.findUnique({
      where: { id: teacherId },
      select: {
        batchesAsTeacher: {
          include,
        },
      },
    }),
  ]);

  const batchMap = new Map<string, (typeof byTeacherId)[number]>();
  for (const batch of byTeacherId) batchMap.set(batch.id, batch);
  for (const batch of teacher?.batchesAsTeacher || []) batchMap.set(batch.id, batch);

  return Array.from(batchMap.values()).sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
}

function normalizeBatchStatus(status?: string | null): "ACTIVE" | "COMPLETED" | "UPCOMING" {
  const value = (status || "ACTIVE").toUpperCase();
  if (value === "COMPLETED") return "COMPLETED";
  if (value === "UPCOMING") return "UPCOMING";
  return "ACTIVE";
}

export const getTeacherBatches = async (req: Request, res: Response): Promise<void> => {
  try {
    const teacherId = req.user!.id;
    const teacher = await prisma.user.findUnique({
      where: { id: teacherId },
      select: { fullName: true },
    });

    const assignedBatches = await getAssignedBatchesForTeacher(teacherId, req.user!.role);
    const batchIds = assignedBatches.map((b) => b.id);

    const enrollmentRows =
      batchIds.length > 0
        ? await prisma.batchStudent.findMany({
            where: { batchId: { in: batchIds } },
            select: { studentId: true },
          })
        : [];

    const batches = assignedBatches.map((b) => ({
      id: b.id,
      name: b.name,
      code: b.code,
      courseId: b.courseId,
      courseName: b.courseName || b.course?.title || "Kathak Course",
      level: b.level || "BEGINNER",
      schedule: b.schedule || "Schedule not set",
      status: normalizeBatchStatus(b.status),
      totalStudents: b._count.students,
      maxStudents: getBatchMaxCapacity(b.name, b.code),
      teacherId: b.teacherId,
      teacherName: b.teacherName,
    }));

    res.json({
      status: "success",
      data: {
        teacherName: teacher?.fullName || "Teacher",
        batches,
        metrics: {
          totalBatches: batches.length,
          totalActiveStudents: new Set(enrollmentRows.map((r) => r.studentId)).size,
          weeklyHours: batches.length > 0 ? Number((batches.length * 4.5).toFixed(1)) : 0,
        },
      },
    });
  } catch (error) {
    console.error("Get Teacher Batches Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch teacher batches." });
  }
};

export const getTeacherBatchStudents = async (req: Request, res: Response): Promise<void> => {
  try {
    const teacherId = req.user!.id;
    const batchId = req.params.batchId as string;

    const batch = await prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) {
      res.status(404).json({ status: "error", message: "Batch not found." });
      return;
    }

    const allowed = await teacherOwnsBatch(teacherId, batch, req.user!.role);
    if (!allowed) {
      res.status(403).json({ status: "error", message: "You do not have access to this batch." });
      return;
    }

    const students = await prisma.batchStudent.findMany({
      where: { batchId },
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
      },
      orderBy: { createdAt: "desc" },
    });

    const mappedStudents = await Promise.all(
      students.map(async (bs) => {
        const batchAssignmentsCount = await (prisma as any).assignment.count({
          where: {
            OR: [{ batchId: bs.batchId }, { batchName: batch.name }, { batchName: batch.code }],
          },
        });

        const submittedCount = await (prisma as any).assignmentSubmission.count({
          where: {
            studentId: bs.student.id,
            assignment: {
              OR: [{ batchId: bs.batchId }, { batchName: batch.name }, { batchName: batch.code }],
            },
          },
        });

        return {
          id: bs.student.id,
          fullName: bs.student.fullName,
          name: bs.student.fullName,
          email: bs.student.email,
          avatar: bs.student.avatarUrl || "/Ananya.png",
          studentId: `#KL-2024-${bs.student.id.slice(0, 4).toUpperCase()}`,
          batchName: batch.code || batch.name,
          batchId: batch.id,
          joiningDate: new Date(bs.createdAt || bs.student.createdAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
          assignmentsSubmitted: `${submittedCount}/${batchAssignmentsCount} Submitted`,
        };
      })
    );

    res.json({
      status: "success",
      data: mappedStudents,
    });
  } catch (error) {
    console.error("Get Teacher Batch Students Error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch batch students." });
  }
};
