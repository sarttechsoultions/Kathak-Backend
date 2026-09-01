import { randomUUID } from "crypto";
import { Server, Socket } from "socket.io";
import { Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { extractSocketToken, verifySocketToken } from "../../lib/socketAuth";
import { AuthUser } from "../../types/auth";
import { canTeacherJoinClass, TEACHER_EARLY_JOIN_MINUTES } from "../../lib/liveClassAccess";
import { teacherOwnsBatch } from "../../lib/teacherBatchAccess";

type ChatMessage = { id: string; senderName: string; text: string; sentAt: string };
type Participant = {
  id: string;
  userName: string;
  userRole: string;
  joinedAt: string;
  studentId?: string;
  agoraUid?: number;
};

const isHostRole = (role?: string) => {
  const value = String(role || "").toLowerCase();
  return value === "teacher" || value === "admin";
};

const isStudentRole = (role?: string) => {
  const value = String(role || "student").toLowerCase();
  return value === "student";
};

const roomParticipants: Record<string, Map<string, Participant>> = {};
const participantJoinTimes: Record<string, Date> = {};
const messageRateLimit: Record<string, number> = {};

const MAX_MESSAGE_LENGTH = 500;
const MESSAGE_COOLDOWN_MS = 400;

function roleLabel(user: AuthUser): string {
  if (user.role === Role.ADMIN) return "Admin";
  if (user.role === Role.TEACHER) return "Teacher";
  return "Student";
}

async function loadChatHistory(liveClassId: string): Promise<ChatMessage[]> {
  const rows = await prisma.liveClassChatMessage.findMany({
    where: { liveClassId },
    orderBy: { sentAt: "asc" },
    take: 100,
  });

  return rows.map((row) => ({
    id: row.id,
    senderName: row.senderName,
    text: row.text,
    sentAt: row.sentAt.toISOString(),
  }));
}

async function assertLiveClassRoomAccess(user: AuthUser, roomName: string) {
  const liveClass = await prisma.liveClass.findUnique({
    where: { roomName },
    include: { batch: { select: { id: true, name: true, code: true, courseName: true, teacherId: true } } },
  });

  if (!liveClass) {
    throw new Error("Live class room not found.");
  }

  if (liveClass.status === "COMPLETED" || liveClass.status === "CANCELLED") {
    throw new Error("This class is no longer active.");
  }

  if (user.role === Role.STUDENT) {
    if (liveClass.status !== "LIVE") {
      throw new Error("This class has not started yet.");
    }
    const membership = await prisma.batchStudent.findFirst({
      where: { studentId: user.id, batchId: liveClass.batchId },
      select: { id: true },
    });
    if (!membership) {
      throw new Error("You are not enrolled in this class batch.");
    }
  }

  if (user.role === Role.TEACHER) {
    const allowed = await teacherOwnsBatch(user.id, liveClass.batch, user.role);
    if (!allowed) {
      throw new Error("You are not assigned to this class.");
    }
    if (liveClass.status === "SCHEDULED" && !canTeacherJoinClass(liveClass)) {
      throw new Error(
        `You can join this class ${TEACHER_EARLY_JOIN_MINUTES} minutes before the scheduled time.`
      );
    }
  }

  return liveClass;
}

export function registerLiveClassSocket(io: Server) {
  io.use(async (socket, next) => {
    try {
      const token = extractSocketToken(
        socket.handshake.auth as Record<string, unknown> | undefined,
        socket.handshake.headers.authorization,
        socket.handshake.headers.cookie
      );

      if (!token) {
        next(new Error("Authentication required."));
        return;
      }

      const user = await verifySocketToken(token);
      if (!user) {
        next(new Error("Invalid or expired session."));
        return;
      }

      socket.data.user = user;
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error("Socket authentication failed."));
    }
  });

  io.on("connection", (socket: Socket) => {
    const authUser = socket.data.user as AuthUser | undefined;
    if (!authUser) {
      socket.disconnect(true);
      return;
    }

    socket.on(
      "liveclass:join",
      async ({
        roomName,
        agoraUid,
      }: {
        roomName: string;
        userName?: string;
        userRole?: string;
        studentId?: string;
        agoraUid?: number;
      }) => {
        if (!roomName) return;

        try {
          const liveClass = await assertLiveClassRoomAccess(authUser, roomName);
          const dbUser = await prisma.user.findUnique({
            where: { id: authUser.id },
            select: { fullName: true, email: true },
          });
          const userName = dbUser?.fullName?.trim() || authUser.email || "User";
          const userRole = roleLabel(authUser);
          const studentId = authUser.role === Role.STUDENT ? authUser.id : authUser.id;

          socket.join(roomName);

          const history = await loadChatHistory(liveClass.id);
          socket.emit("liveclass:chat-history", history);
          socket.emit("liveclass:joined", { roomName });

          const joinTime = new Date();
          participantJoinTimes[socket.id] = joinTime;

          socket.data.roomName = roomName;
          socket.data.userName = userName;
          socket.data.userRole = userRole;
          socket.data.studentId = studentId;
          socket.data.liveClassId = liveClass.id;

          if (!roomParticipants[roomName]) {
            roomParticipants[roomName] = new Map();
          }

          const participant: Participant = {
            id: socket.id,
            userName,
            userRole,
            joinedAt: joinTime.toISOString(),
            studentId: authUser.role === Role.STUDENT ? authUser.id : undefined,
            agoraUid: Number.isFinite(Number(agoraUid)) && Number(agoraUid) > 0 ? Number(agoraUid) : undefined,
          };

          roomParticipants[roomName].set(socket.id, participant);
          broadcastRoomUsers(io, roomName);
          io.to(roomName).emit("liveclass:user-joined", participant);

          if (isHostRole(userRole) && liveClass.status === "SCHEDULED") {
            const updated = await prisma.liveClass.update({
              where: { id: liveClass.id },
              data: { status: "LIVE" },
              include: { batch: { select: { name: true, code: true, courseName: true, teacherId: true } } },
            });
            io.to(roomName).emit("liveclass:status-changed", "LIVE");
            io.emit("liveclass:class-updated", {
              ...updated,
              batchName: updated.batch.name,
              batchCode: updated.batch.code,
              courseName: updated.batch.courseName,
            });
          }
        } catch (error) {
          socket.emit("liveclass:error", {
            message: error instanceof Error ? error.message : "Unable to join this room.",
          });
        }
      }
    );

    const handleUserLeave = async (socket: Socket) => {
      const roomName = socket.data.roomName as string | undefined;
      const userName = socket.data.userName as string | undefined;
      const studentId = socket.data.studentId as string | undefined;
      const userRole = socket.data.userRole as string | undefined;
      const joinTime = participantJoinTimes[socket.id];
      const authUser = socket.data.user as AuthUser | undefined;

      if (roomName && roomParticipants[roomName]) {
        const removed = roomParticipants[roomName].delete(socket.id);

        if (removed) {
          broadcastRoomUsers(io, roomName);
          io.to(roomName).emit("liveclass:user-left", {
            id: socket.id,
            userName: userName || "User",
          });
        }

        if (roomParticipants[roomName].size === 0) {
          delete roomParticipants[roomName];
        }

        if (joinTime && isStudentRole(userRole) && authUser?.role === Role.STUDENT) {
          try {
            const leaveTime = new Date();
            const durationMinutes = Math.max(1, Math.round((leaveTime.getTime() - joinTime.getTime()) / (1000 * 60)));
            delete participantJoinTimes[socket.id];

            const liveClass = await prisma.liveClass.findUnique({ where: { roomName } });
            if (liveClass) {
              const todayStart = new Date();
              todayStart.setHours(0, 0, 0, 0);
              const todayEnd = new Date();
              todayEnd.setHours(23, 59, 59, 999);

              const existingAttendance = await prisma.attendance.findFirst({
                where: {
                  studentId: authUser.id,
                  batchId: liveClass.batchId,
                  date: { gte: todayStart, lte: todayEnd },
                  session: liveClass.title,
                },
              });

              if (existingAttendance) {
                const joinTimeString = joinTime.toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: true,
                });
                const leaveTimeString = leaveTime.toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: true,
                });

                await prisma.attendance.update({
                  where: { id: existingAttendance.id },
                  data: {
                    remarks: `Auto-marked: Joined at ${joinTimeString}, Left at ${leaveTimeString} (${durationMinutes} mins attended).`,
                  },
                });
              }
            }
          } catch (err) {
            console.error("Auto-Attendance Leave Recording Error:", err);
          }
        }
      } else {
        delete participantJoinTimes[socket.id];
      }

      delete messageRateLimit[socket.id];
    };

    socket.on("liveclass:leave", ({ roomName }: { roomName: string }) => {
      if (roomName) {
        socket.leave(roomName);
        void handleUserLeave(socket);
      }
    });

    socket.on("liveclass:message", async (payload: { roomName: string; message: ChatMessage }) => {
      if (!payload?.roomName || !payload?.message?.text?.trim()) return;
      if (socket.data.roomName !== payload.roomName) {
        socket.emit("liveclass:error", {
          message: "Chat is not connected yet. Wait a moment and try again.",
        });
        return;
      }

      const now = Date.now();
      const lastSent = messageRateLimit[socket.id] || 0;
      if (now - lastSent < MESSAGE_COOLDOWN_MS) return;
      messageRateLimit[socket.id] = now;

      const text = payload.message.text.trim().slice(0, MAX_MESSAGE_LENGTH);
      const senderName = String(socket.data.userName || "User");
      const liveClassId = socket.data.liveClassId as string | undefined;
      const authUser = socket.data.user as AuthUser | undefined;

      let saved: ChatMessage;
      try {
        if (liveClassId) {
          const row = await prisma.liveClassChatMessage.create({
            data: {
              liveClassId,
              senderId: authUser?.id,
              senderName,
              text,
            },
          });
          saved = {
            id: row.id,
            senderName: row.senderName,
            text: row.text,
            sentAt: row.sentAt.toISOString(),
          };
        } else {
          saved = {
            id: payload.message.id || randomUUID(),
            senderName,
            text,
            sentAt: new Date().toISOString(),
          };
        }
      } catch (err) {
        console.error("Failed to persist chat message:", err);
        saved = {
          id: payload.message.id || randomUUID(),
          senderName,
          text,
          sentAt: new Date().toISOString(),
        };
      }

      io.to(payload.roomName).emit("liveclass:message", saved);
    });

    socket.on("liveclass:raise-hand", (payload: { roomName: string; raised?: boolean; senderName?: string }) => {
      if (!payload?.roomName || socket.data.roomName !== payload.roomName) return;
      if (!isStudentRole(String(socket.data.userRole))) return;

      io.to(payload.roomName).emit("liveclass:raise-hand", {
        senderName: String(payload.senderName || socket.data.userName || "Student"),
        studentId: socket.data.studentId as string | undefined,
        raised: payload.raised !== false,
        at: new Date().toISOString(),
      });
    });

    socket.on(
      "liveclass:media-control",
      (payload: {
        roomName: string;
        targetSocketId?: string;
        targetStudentId?: string;
        targetAgoraUid?: number;
        camera?: boolean;
        mic?: boolean;
      }) => {
        if (!isHostRole(String(socket.data.userRole)) || !payload?.roomName) return;
        if (socket.data.roomName !== payload.roomName) return;
        if (payload.camera === undefined && payload.mic === undefined) return;

        const participants = roomParticipants[payload.roomName];
        if (!participants) return;

        const list = Array.from(participants.values());
        const target =
          (payload.targetSocketId ? participants.get(payload.targetSocketId) : undefined) ||
          (payload.targetStudentId
            ? list.find((p) => p.studentId && p.studentId === payload.targetStudentId)
            : undefined) ||
          (payload.targetAgoraUid != null
            ? list.find((p) => p.agoraUid === payload.targetAgoraUid)
            : undefined);

        if (!target || !isStudentRole(target.userRole)) return;

        io.to(target.id).emit("liveclass:media-control", {
          camera: payload.camera,
          mic: payload.mic,
          requestedBy: socket.data.userName || "Host",
        });
      }
    );

    socket.on("disconnect", () => {
      void handleUserLeave(socket);
    });
  });

  setInterval(() => {
    for (const roomName of Object.keys(roomParticipants)) {
      const liveRoom = io.sockets.adapter.rooms.get(roomName);
      const liveSocketIds = liveRoom ? new Set(liveRoom) : new Set<string>();

      let changed = false;
      for (const socketId of Array.from(roomParticipants[roomName].keys())) {
        if (!liveSocketIds.has(socketId)) {
          roomParticipants[roomName].delete(socketId);
          delete participantJoinTimes[socketId];
          delete messageRateLimit[socketId];
          changed = true;
        }
      }

      if (roomParticipants[roomName].size === 0) {
        delete roomParticipants[roomName];
        continue;
      }

      if (changed) {
        broadcastRoomUsers(io, roomName);
      }
    }
  }, 30000);
}

function broadcastRoomUsers(io: Server, roomName: string) {
  const currentList = roomParticipants[roomName] ? Array.from(roomParticipants[roomName].values()) : [];
  io.to(roomName).emit("liveclass:room-users", currentList);
}
