import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { UploadError } from "./direct-video.policy";

/** Serialize record creation for a direct asset. Historical URLs keep their
 * current behavior. A row lock covers both record creation and its intent link.
 */
export async function createMediaRecordOnce<T extends { id: string }>(
  url: string, scope: string,
  create: (tx: Prisma.TransactionClient) => Promise<T>,
  find: (tx: Prisma.TransactionClient, id: string) => Promise<T | null>,
): Promise<T> {
  if (!url.includes("kathak_direct/")) return create(prisma);
  return prisma.$transaction(async tx => {
    const intent = await tx.videoUploadIntent.findUnique({ where: { playbackUrl: url } });
    if (!intent) throw new UploadError(400, "Verified upload not found.");
    await tx.$queryRaw`SELECT "id" FROM "VideoUploadIntent" WHERE "id" = ${intent.id} FOR UPDATE`;
    const locked = await tx.videoUploadIntent.findUniqueOrThrow({ where: { id: intent.id } });
    if (locked.status !== "READY") throw new UploadError(409, "Video is not ready.");
    const links = (locked.links || {}) as Record<string, string>;
    const existing = links[scope] ? await find(tx, links[scope]) : null;
    if (existing) return existing;
    const created = await create(tx);
    await tx.videoUploadIntent.update({ where: { id: locked.id }, data: { links: { ...links, [scope]: created.id } } });
    return created;
  });
}
