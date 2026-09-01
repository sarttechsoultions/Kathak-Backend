import { Role } from "@prisma/client";
import { prisma } from "./prisma";

export async function teacherOwnsBatch(
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
