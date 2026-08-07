// src/lib/batchHelpers.ts
import { prisma } from "./prisma";

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

/** Display name for a user based on their ID */
export async function getUserDisplayName(userId: string, fallbackEmail?: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fullName: true, email: true },
  });
  return user?.fullName || fallbackEmail || "User";
}