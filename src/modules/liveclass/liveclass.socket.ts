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
        if (!roomName) return;
        socket.join(roomName);

        // Send room chat history snapshot to joining user
        if (roomChatHistory[roomName]) {
          socket.emit("liveclass:chat-history", roomChatHistory[roomName]);
        } else {
          roomChatHistory[roomName] = [];
          socket.emit("liveclass:chat-history", []);
        }

        if (userName) {
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

          roomParticipants[roomName].set(userName, participant);

          // Emit room participants snapshot to all users in room
          const currentList = Array.from(roomParticipants[roomName].values());
          io.to(roomName).emit("liveclass:room-users", currentList);
          io.to(roomName).emit("liveclass:user-joined", participant);

          // AUTO-MARK ATTENDANCE FOR STUDENTS IN DATABASE
          if (userRole === "Student" || !userRole || userRole.toLowerCase() === "student") {
            try {
              const liveClass = await prisma.liveClass.findUnique({
                where: { roomName },
                include: { batch: true },
              });

              if (liveClass) {
                // Find student record in DB, preferring the authoritative
                // studentId. Only fall back to a name/email match when it
                // resolves to exactly one student — a findFirst here would
                // silently mark the wrong person present if two students
                // share a display name.
                let dbStudent = null;
                if (studentId) {
                  dbStudent = await prisma.user.findUnique({ where: { id: studentId } });
                }
                if (!dbStudent && userName) {
                  const candidates = await prisma.user.findMany({
                    where: { OR: [{ fullName: userName }, { email: userName }], role: "STUDENT" },
                    take: 2,
                  });
                  if (candidates.length === 1) {
                    dbStudent = candidates[0];
                  } else if (candidates.length > 1) {
                    console.warn(`Attendance skipped: ambiguous name "${userName}" matches ${candidates.length} students.`);
                  }
                }

                if (dbStudent) {
                  const joinTimeString = joinTime.toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true,
                  });

                  // Check if student joined > 15 minutes after class start
                  const startDiffMinutes = (joinTime.getTime() - liveClass.scheduledStart.getTime()) / (1000 * 60);
                  const attendanceStatus = startDiffMinutes > 15 ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;

                  const todayStart = new Date();
                  todayStart.setHours(0, 0, 0, 0);
                  const todayEnd = new Date();
                  todayEnd.setHours(23, 59, 59, 999);

                  // Check if attendance already exists for today's live class session
                  const existingAttendance = await prisma.attendance.findFirst({
                    where: {
                      studentId: dbStudent.id,
                      batchId: liveClass.batchId,
                      date: { gte: todayStart, lte: todayEnd },
                      session: liveClass.title,
                    },
                  });

                  if (!existingAttendance) {
                    await prisma.attendance.create({
                      data: {
                        studentId: dbStudent.id,
                        studentName: dbStudent.fullName,
                        batchId: liveClass.batchId,
                        batchName: liveClass.batch.name,
                        session: liveClass.title,
                        date: new Date(),
                        status: attendanceStatus,
                        remarks: `Auto-marked: Joined live class at ${joinTimeString}.`,
                      },
                    });
                    console.log(`✅ Auto-marked attendance [${attendanceStatus}] for student ${dbStudent.fullName} in ${liveClass.title}`);
                  }
                }
              }
            } catch (err) {
              console.error("Auto-Attendance Join Recording Error:", err);
            }
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
        if (userName) {
          roomParticipants[roomName].delete(userName);
        }
        for (const [key, p] of roomParticipants[roomName].entries()) {
          if (p.id === socket.id) {
            roomParticipants[roomName].delete(key);
          }
        }
        const currentList = Array.from(roomParticipants[roomName].values());
        io.to(roomName).emit("liveclass:room-users", currentList);
        io.to(roomName).emit("liveclass:user-left", {
          id: socket.id,
          userName: userName || "User",
        });

        // UPDATE DURATION & LEAVE TIME IN DATABASE ATTENDANCE RECORD
        if (joinTime && (userRole === "Student" || !userRole || userRole.toLowerCase() === "student")) {
          try {
            const leaveTime = new Date();
            const durationMinutes = Math.max(1, Math.round((leaveTime.getTime() - joinTime.getTime()) / (1000 * 60)));
            delete participantJoinTimes[socket.id];

            const liveClass = await prisma.liveClass.findUnique({
              where: { roomName },
            });

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
}