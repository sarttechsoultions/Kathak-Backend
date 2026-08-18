import { Server, Socket } from "socket.io";
import { prisma } from "../../lib/prisma";
import { AttendanceStatus } from "@prisma/client";

type ChatMessage = { id: string; senderName: string; text: string; sentAt: string };
type Participant = { id: string; userName: string; userRole: string; joinedAt: string; studentId?: string };

const roomParticipants: Record<string, Map<string, Participant>> = {};
const roomChatHistory: Record<string, ChatMessage[]> = {};
const participantJoinTimes: Record<string, Date> = {}; // key: socket.id

export function registerLiveClassSocket(io: Server) {
  io.on("connection", (socket: Socket) => {

    socket.on(
      "liveclass:join",
      async ({
        roomName,
        userName,
        userRole,
        studentId,
      }: {
        roomName: string;
        userName?: string;
        userRole?: string;
        studentId?: string;
      }) => {
        if (!roomName || !userName) return;

        socket.join(roomName);

        if (roomChatHistory[roomName]) {
          socket.emit("liveclass:chat-history", roomChatHistory[roomName]);
        } else {
          roomChatHistory[roomName] = [];
          socket.emit("liveclass:chat-history", []);
        }

        const joinTime = new Date();
        participantJoinTimes[socket.id] = joinTime;

        socket.data.roomName = roomName;
        socket.data.userName = userName;
        socket.data.userRole = userRole || "Student";
        socket.data.studentId = studentId;

        if (!roomParticipants[roomName]) {
          roomParticipants[roomName] = new Map();
        }

        const participant: Participant = {
          id: socket.id,
          userName,
          userRole: userRole || "Student",
          joinedAt: joinTime.toISOString(),
          studentId,
        };

        // ✅ socket.id se key — har physical connection unique entry rakhta hai,
        // isliye same "Admin"/"User" naam wale multiple connections overwrite nahi karte
        roomParticipants[roomName].set(socket.id, participant);

        broadcastRoomUsers(io, roomName);
        io.to(roomName).emit("liveclass:user-joined", participant);

        // AUTO-MARK ATTENDANCE FOR STUDENTS IN DATABASE
        if (userRole === "Student" || !userRole || userRole.toLowerCase() === "student") {
          try {
            const liveClass = await prisma.liveClass.findUnique({
              where: { roomName },
              include: { batch: true },
            });

            if (liveClass) {
              if ((userRole === "Teacher" || userRole === "Admin") && liveClass.status === "SCHEDULED") {
                await prisma.liveClass.update({
                  where: { id: liveClass.id },
                  data: { status: "LIVE" },
                });
                io.to(roomName).emit("liveclass:status-changed", "LIVE");
              }

              let dbUser = null;
              if (studentId) {
                dbUser = await prisma.user.findUnique({ where: { id: studentId } });
              }
              if (!dbUser && userName) {
                const candidates = await prisma.user.findMany({
                  where: { OR: [{ fullName: userName }, { email: userName }] },
                  take: 1,
                });
                dbUser = candidates.length > 0 ? candidates[0] : null;
              }

              if (dbUser) {
                const joinTimeString = joinTime.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
                const startDiffMinutes = (joinTime.getTime() - liveClass.scheduledStart.getTime()) / (1000 * 60);
                const attendanceStatus = startDiffMinutes > 15 ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;

                const todayStart = new Date();
                todayStart.setHours(0, 0, 0, 0);
                const todayEnd = new Date();
                todayEnd.setHours(23, 59, 59, 999);

                const existingAttendance = await prisma.attendance.findFirst({
                  where: {
                    studentId: dbUser.id,
                    batchId: liveClass.batchId,
                    date: { gte: todayStart, lte: todayEnd },
                    session: liveClass.title,
                  },
                });

                if (!existingAttendance) {
                  await prisma.attendance.create({
                    data: {
                      studentId: dbUser.id,
                      studentName: dbUser.fullName,
                      batchId: liveClass.batchId,
                      batchName: liveClass.batch.name,
                      session: liveClass.title,
                      date: new Date(),
                      status: attendanceStatus,
                      remarks: `[${userRole}] Auto-marked: Joined live class at ${joinTimeString}.`,
                    },
                  });
                  console.log(`✅ Auto-marked attendance [${attendanceStatus}] for ${userRole} ${dbUser.fullName}`);
                }
              }
            }
          } catch (err) {
            console.error("Auto-Attendance Join Recording Error:", err);
          }
        }
      }
    );

    const handleUserLeave = async (socket: Socket) => {
      const roomName = socket.data.roomName;
      const userName = socket.data.userName;
      const studentId = socket.data.studentId;
      const userRole = socket.data.userRole;
      const joinTime = participantJoinTimes[socket.id];

      if (roomName && roomParticipants[roomName]) {
        // ✅ direct delete by socket.id — no loop, no ambiguity
        const removed = roomParticipants[roomName].delete(socket.id);

        if (removed) {
          broadcastRoomUsers(io, roomName);
          io.to(roomName).emit("liveclass:user-left", {
            id: socket.id,
            userName: userName || "User",
          });
        }

        // Room khaali ho gaya toh memory clean karo
        if (roomParticipants[roomName].size === 0) {
          delete roomParticipants[roomName];
        }

        if (joinTime && (userRole === "Student" || !userRole || userRole.toLowerCase() === "student")) {
          try {
            const leaveTime = new Date();
            const durationMinutes = Math.max(1, Math.round((leaveTime.getTime() - joinTime.getTime()) / (1000 * 60)));
            delete participantJoinTimes[socket.id];

            const liveClass = await prisma.liveClass.findUnique({ where: { roomName } });

            if (liveClass) {
              let dbStudent = null;
              if (studentId) {
                dbStudent = await prisma.user.findUnique({ where: { id: studentId } });
              }
              if (!dbStudent && userName) {
                const candidates = await prisma.user.findMany({
                  where: { OR: [{ fullName: userName }, { email: userName }], role: "STUDENT" },
                  take: 2,
                });
                dbStudent = candidates.length === 1 ? candidates[0] : null;
              }

              if (dbStudent) {
                const joinTimeString = joinTime.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
                const leaveTimeString = leaveTime.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

                const todayStart = new Date();
                todayStart.setHours(0, 0, 0, 0);
                const todayEnd = new Date();
                todayEnd.setHours(23, 59, 59, 999);

                const existingAttendance = await prisma.attendance.findFirst({
                  where: {
                    studentId: dbStudent.id,
                    batchId: liveClass.batchId,
                    date: { gte: todayStart, lte: todayEnd },
                    session: liveClass.title,
                  },
                });

                if (existingAttendance) {
                  await prisma.attendance.update({
                    where: { id: existingAttendance.id },
                    data: {
                      remarks: `Auto-marked: Joined at ${joinTimeString}, Left at ${leaveTimeString} (${durationMinutes} mins attended).`,
                    },
                  });
                  console.log(`⏱️ Updated attendance duration [${durationMinutes} mins] for student ${dbStudent.fullName}`);
                }
              }
            }
          } catch (err) {
            console.error("Auto-Attendance Leave Recording Error:", err);
          }
        }
      } else {
        // Room reference nahi mila socket.data mein, phir bhi stale timer clean karo
        delete participantJoinTimes[socket.id];
      }
    };

    socket.on("liveclass:leave", ({ roomName }: { roomName: string }) => {
      if (roomName) {
        socket.leave(roomName);
        handleUserLeave(socket);
      }
    });

    socket.on("liveclass:message", (payload: { roomName: string; message: ChatMessage }) => {
      if (!payload?.roomName || !payload?.message) return;
      socket.join(payload.roomName);

      if (!roomChatHistory[payload.roomName]) {
        roomChatHistory[payload.roomName] = [];
      }

      if (!roomChatHistory[payload.roomName].some((m) => m.id === payload.message.id)) {
        roomChatHistory[payload.roomName].push(payload.message);
      }

      io.to(payload.roomName).emit("liveclass:message", payload.message);
    });

    socket.on("liveclass:raise-hand", (payload: { roomName: string; senderName: string }) => {
      if (!payload?.roomName) return;
      socket.join(payload.roomName);
      io.to(payload.roomName).emit("liveclass:raise-hand", {
        senderName: payload.senderName || "Student",
        at: new Date().toISOString(),
      });
    });

    socket.on("disconnect", () => {
      handleUserLeave(socket);
    });
  });

  // ✅ Production safety net: har 30 sec pe verify karo ki roomParticipants
  // mein jo socket.id hain wo actually abhi bhi Socket.IO se connected hain.
  // Agar koi 'disconnect' event kisi wajah se miss ho gaya (network blip,
  // process crash mid-cleanup), ye sweep use apne aap remove kar dega
  // aur sabko updated list bhej dega — bina server restart ke.
  setInterval(() => {
    for (const roomName of Object.keys(roomParticipants)) {
      const liveRoom = io.sockets.adapter.rooms.get(roomName);
      const liveSocketIds = liveRoom ? new Set(liveRoom) : new Set<string>();

      let changed = false;
      for (const socketId of Array.from(roomParticipants[roomName].keys())) {
        if (!liveSocketIds.has(socketId)) {
          roomParticipants[roomName].delete(socketId);
          delete participantJoinTimes[socketId];
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
  const currentList = roomParticipants[roomName]
    ? Array.from(roomParticipants[roomName].values())
    : [];
  io.to(roomName).emit("liveclass:room-users", currentList);
}