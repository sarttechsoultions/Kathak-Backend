import { Server } from "socket.io";
import { PrismaClient } from "@prisma/client";

const batchRoom = (batchId: string) => `liveclass:batch:${batchId}`;
const adminRoom = "liveclass:admins";

export async function subscribeToLiveClassUpdates(
  socket: { join: (room: string) => unknown },
  user: { id: string; role: string },
  prisma: PrismaClient
) {
  if (user.role === "ADMIN") {
    socket.join(adminRoom);
    return;
  }

  const rows = user.role === "TEACHER"
    ? await prisma.batch.findMany({ where: { teacherId: user.id }, select: { id: true } })
    : await prisma.batchStudent.findMany({ where: { studentId: user.id }, select: { batchId: true } });

  for (const row of rows) {
    socket.join(batchRoom("id" in row ? row.id : row.batchId));
  }
}

export function broadcastLiveClassEvent(
  io: Server,
  event: "liveclass:class-created" | "liveclass:class-updated",
  liveClass: { batchId: string; [key: string]: unknown }
) {
  io.to(adminRoom).emit(event, liveClass);
  io.to(batchRoom(liveClass.batchId)).emit(event, liveClass);
}
