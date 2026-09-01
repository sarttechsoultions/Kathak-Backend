import { prisma } from "./prisma";

type RecordedClassGroupFields = {
  id?: string;
  videoId?: string | null;
  videoUrl: string;
  title: string;
  createdAt: Date;
};

export function getRecordedClassGroupKey(item: RecordedClassGroupFields): string {
  const stamp = item.createdAt.toISOString().slice(0, 19);
  const videoKey = item.videoId || item.videoUrl;
  return `${videoKey}|${item.title}|${stamp}`;
}

export async function findLinkedRecordedClassIds(
  recordedClass: RecordedClassGroupFields
): Promise<string[]> {
  const createdAtStart = new Date(recordedClass.createdAt);
  createdAtStart.setSeconds(createdAtStart.getSeconds() - 2);
  const createdAtEnd = new Date(recordedClass.createdAt);
  createdAtEnd.setSeconds(createdAtEnd.getSeconds() + 2);

  const candidates = await prisma.recordedClass.findMany({
    where: {
      title: recordedClass.title,
      videoUrl: recordedClass.videoUrl,
      createdAt: { gte: createdAtStart, lte: createdAtEnd },
      ...(recordedClass.videoId ? { videoId: recordedClass.videoId } : {}),
    },
    select: { id: true },
  });

  const ids = candidates.map((entry) => entry.id);
  return ids.length > 0 ? ids : recordedClass.id ? [recordedClass.id] : [];
}

type ViewHistoryRow = {
  id: string;
  userId: string;
  viewedAt: Date;
  deviceType: string | null;
  browser: string | null;
  ipAddress: string | null;
  location: string | null;
  user: {
    id: string;
    fullName: string | null;
    email: string;
  };
};

export function mergeViewHistoryByUser(rows: ViewHistoryRow[]): ViewHistoryRow[] {
  const byUser = new Map<string, ViewHistoryRow>();

  for (const row of rows) {
    const existing = byUser.get(row.userId);
    if (!existing || row.viewedAt > existing.viewedAt) {
      byUser.set(row.userId, row);
    }
  }

  return Array.from(byUser.values()).sort(
    (a, b) => b.viewedAt.getTime() - a.viewedAt.getTime()
  );
}

export function dedupeRecordedClassesForStudent<
  T extends RecordedClassGroupFields & { batchId?: string | null; courseId?: string | null }
>(classes: T[], studentBatchIds: string[] = []): T[] {
  const seen = new Map<string, T>();

  for (const item of classes) {
    const key = getRecordedClassGroupKey(item);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, item);
      continue;
    }

    const itemInStudentBatch = Boolean(item.batchId && studentBatchIds.includes(item.batchId));
    const existingInStudentBatch = Boolean(
      existing.batchId && studentBatchIds.includes(existing.batchId)
    );

    if (itemInStudentBatch && !existingInStudentBatch) {
      seen.set(key, item);
    }
  }

  return Array.from(seen.values());
}
