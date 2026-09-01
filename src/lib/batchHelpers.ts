// src/lib/batchHelpers.ts
import { prisma } from "./prisma";

/** Personal 1-to-1 batches are auto-created at enrollment and must not be joinable by other students. */
export function isOneToOneBatch(name?: string | null, code?: string | null): boolean {
  const batchName = String(name || "").toLowerCase();
  const batchCode = String(code || "").toUpperCase();
  return (
    batchName.includes("1-to-1") ||
    batchName.includes("1 to 1") ||
    batchName.includes("one-to-one") ||
    batchName.includes("one to one") ||
    batchCode.startsWith("OTO-")
  );
}

/** Max enrollment capacity shown in UI — 1 for personal batches, 20 for group batches. */
export function getBatchMaxCapacity(name?: string | null, code?: string | null): number {
  return isOneToOneBatch(name, code) ? 1 : 20;
}

function normalizeBatchKey(value?: string | null): string {
  return String(value || "").trim().toLowerCase();
}

export function isAcademyWideAssignment(batchName?: string | null): boolean {
  const targetLower = normalizeBatchKey(batchName);
  return (
    !targetLower ||
    targetLower === "all batches" ||
    targetLower === "all" ||
    targetLower === "all batches & courses"
  );
}

/** Whether an assignment targets a specific enrolled student batch (not academy-wide). */
export function assignmentAppliesToStudentBatch(
  assignment: { batchId?: string | null; batchName?: string | null },
  studentBatch: { id: string; name?: string | null; code?: string | null }
): boolean {
  if (assignment.batchId && assignment.batchId === studentBatch.id) return true;

  const rawTarget = String(assignment.batchName || "").trim();
  if (!rawTarget) return false;

  if (isAcademyWideAssignment(rawTarget)) {
    return false;
  }

  const studentKeys = [studentBatch.name, studentBatch.code]
    .filter(Boolean)
    .map((value) => normalizeBatchKey(value));
  const targetList = rawTarget.split(",").map((part) => normalizeBatchKey(part));

  return studentKeys.some((studentKey) =>
    targetList.some(
      (targetName) =>
        targetName === studentKey ||
        targetName.includes(studentKey) ||
        studentKey.includes(targetName)
    )
  );
}

export function resolveStudentBatchForAssignment<
  T extends { batchId?: string | null; batchName?: string | null },
  B extends { id: string; name: string; code: string; courseName?: string | null }
>(
  assignment: T,
  studentBatches: Array<{ batchId: string; batch: B }>
): B | null {
  if (studentBatches.length === 0) return null;

  if (!assignment.batchId && isAcademyWideAssignment(assignment.batchName)) {
    return studentBatches[0].batch;
  }

  for (const membership of studentBatches) {
    if (assignmentAppliesToStudentBatch(assignment, membership.batch)) {
      return membership.batch;
    }
  }
  return null;
}

export type StudentBatchMembershipRow = {
  batchId: string;
  batch: { id: string; name: string; code: string; courseName?: string | null };
};

/** All batch memberships for a student (supports multi-batch enrollment). */
export async function getStudentBatchMembershipRows(studentId: string): Promise<StudentBatchMembershipRow[]> {
  const memberships = await prisma.batchStudent.findMany({
    where: { studentId },
    include: {
      batch: {
        select: { id: true, name: true, code: true, courseName: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return memberships.map((membership) => ({
    batchId: membership.batch.id,
    batch: membership.batch,
  }));
}

/** Prisma where-clause for content targeted at a student's enrolled batches. */
export function buildStudentBatchTargetWhere(
  memberships: StudentBatchMembershipRow[]
): Record<string, unknown> {
  if (memberships.length === 0) {
    return { id: { in: [] } };
  }

  const orConditions: Record<string, unknown>[] = [
    { batchName: { equals: "all batches", mode: "insensitive" } },
    { batchName: { equals: "All Batches", mode: "insensitive" } },
    { batchName: "" },
  ];

  for (const membership of memberships) {
    orConditions.push({ batchId: membership.batch.id });
    orConditions.push({ batchName: membership.batch.name });
    orConditions.push({ batchName: membership.batch.code });
    orConditions.push({ batchName: { contains: membership.batch.name, mode: "insensitive" } });
    orConditions.push({ batchName: { contains: membership.batch.code, mode: "insensitive" } });
  }

  return { OR: orConditions };
}

export function studentCanAccessBatchTarget<
  T extends { batchId?: string | null; batchName?: string | null },
  B extends { id: string; name: string; code: string; courseName?: string | null }
>(target: T, memberships: Array<{ batchId: string; batch: B }>): boolean {
  return resolveStudentBatchForAssignment(target, memberships) !== null;
}

/** Retrieve batch names assigned to the teacher using teacherId or exact teacherName */
export async function getTeacherBatchNames(teacherId: string, teacherName?: string): Promise<string[]> {
  try {
    const batches = await prisma.batch.findMany({
      where: teacherName
        ? { teacherName: { equals: teacherName, mode: "insensitive" as const } }
        : {},
      select: { name: true, code: true },
    });

    return batches.flatMap((b) => [b.name, b.code].filter((val): val is string => Boolean(val)));
  } catch {
    return [];
  }
}

/** Get the student's primary batch name from memberships or enrollments */
export async function getStudentBatchName(studentId: string): Promise<string> {
  try {
    const membership = await prisma.batchStudent.findFirst({
      where: { studentId },
      include: { batch: { select: { name: true, code: true } } },
      orderBy: { createdAt: "desc" },
    });
    if (membership?.batch?.name) return membership.batch.name;
  } catch {}

  return "";
}

/** Batch IDs assigned to a teacher (by teacherId field or relation). */
export async function getTeacherBatchIds(userId: string): Promise<string[]> {
  const [byTeacherId, teacherData] = await Promise.all([
    prisma.batch.findMany({
      where: { teacherId: userId },
      select: { id: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { batchesAsTeacher: { select: { id: true } } },
    }),
  ]);

  const ids = new Set<string>();
  byTeacherId.forEach((b) => ids.add(b.id));
  teacherData?.batchesAsTeacher?.forEach((b) => ids.add(b.id));
  return Array.from(ids);
}

/** Display name for a user based on their ID */
export async function getUserDisplayName(userId: string, fallbackEmail?: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fullName: true, email: true },
  });
  return user?.fullName || fallbackEmail || "User";
}