import { randomUUID } from "crypto";
import { Server, Socket } from "socket.io";
import { Role } from "@prisma/client";

import { prisma } from "../../lib/prisma";
import {
  extractSocketToken,
  verifySocketToken,
} from "../../lib/socketAuth";
import { AuthUser } from "../../types/auth";
import {
  canTeacherJoinClass,
  TEACHER_EARLY_JOIN_MINUTES,
} from "../../lib/liveClassAccess";
import { teacherOwnsBatch } from "../../lib/teacherBatchAccess";

type ChatMessage = {
  id: string;
  senderName: string;
  text: string;
  sentAt: string;
};

type Participant = {
  id: string;
  userName: string;
  userRole: string;
  joinedAt: string;
  studentId?: string;
  agoraUid?: number;

  // Real-time media state
  cameraOn: boolean;
  micOn: boolean;

  // Meeting state
  handRaised: boolean;
};

type MediaStatePayload = {
  roomName: string;
  cameraOn?: boolean;
  micOn?: boolean;
};

const isHostRole = (role?: string) => {
  const value = String(role || "").toLowerCase();
  return value === "teacher" || value === "admin";
};

const isStudentRole = (role?: string) => {
  const value = String(role || "student").toLowerCase();
  return value === "student";
};

/**
 * In-memory room state.
 *
 * This is fine for a single backend instance.
 * If the backend is later horizontally scaled,
 * move this presence state to Redis + Socket.IO Redis adapter.
 */
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

async function loadChatHistory(
  liveClassId: string
): Promise<ChatMessage[]> {
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

async function assertLiveClassRoomAccess(
  user: AuthUser,
  roomName: string
) {
  const liveClass = await prisma.liveClass.findUnique({
    where: { roomName },
    include: {
      batch: {
        select: {
          id: true,
          name: true,
          code: true,
          courseName: true,
          teacherId: true,
        },
      },
    },
  });

  if (!liveClass) {
    throw new Error("Live class room not found.");
  }

  if (
    liveClass.status === "COMPLETED" ||
    liveClass.status === "CANCELLED"
  ) {
    throw new Error("This class is no longer active.");
  }

  if (user.role === Role.STUDENT) {
    if (
      liveClass.status !== "LIVE" &&
      new Date() < liveClass.scheduledStart
    ) {
      throw new Error("This class has not started yet.");
    }

    const membership = await prisma.batchStudent.findFirst({
      where: {
        studentId: user.id,
        batchId: liveClass.batchId,
      },
      select: {
        id: true,
      },
    });

    if (!membership) {
      throw new Error(
        "You are not enrolled in this class batch."
      );
    }
  }

  if (user.role === Role.TEACHER) {
    const allowed = await teacherOwnsBatch(
      user.id,
      liveClass.batch,
      user.role
    );

    if (!allowed) {
      throw new Error(
        "You are not assigned to this class."
      );
    }

    if (
      liveClass.status === "SCHEDULED" &&
      !canTeacherJoinClass(liveClass)
    ) {
      throw new Error(
        `You can join this class ${TEACHER_EARLY_JOIN_MINUTES} minutes before the scheduled time.`
      );
    }
  }

  return liveClass;
}

function getRoomParticipants(
  roomName: string
): Participant[] {
  const room = roomParticipants[roomName];

  if (!room) {
    return [];
  }

  return Array.from(room.values());
}

function broadcastRoomUsers(
  io: Server,
  roomName: string
) {
  const currentList = getRoomParticipants(roomName);

  io.to(roomName).emit(
    "liveclass:room-users",
    currentList
  );
}

/**
 * Broadcast a single participant's updated state.
 *
 * Useful for lightweight real-time updates without forcing
 * every client to rebuild the entire participant list.
 */
function broadcastParticipantState(
  io: Server,
  roomName: string,
  participant: Participant
) {
  io.to(roomName).emit(
    "liveclass:participant-state",
    participant
  );
}

/**
 * Remove a participant from server-side presence.
 *
 * Returns true only when an actual participant was removed.
 */
function removeParticipantFromRoom(
  roomName: string,
  socketId: string
): Participant | null {
  const room = roomParticipants[roomName];

  if (!room) {
    return null;
  }

  const participant = room.get(socketId);

  if (!participant) {
    return null;
  }

  room.delete(socketId);

  if (room.size === 0) {
    delete roomParticipants[roomName];
  }

  return participant;
}

export function registerLiveClassSocket(io: Server) {
  /**
   * ---------------------------------------------------------
   * SOCKET AUTHENTICATION
   * ---------------------------------------------------------
   */
  io.use(async (socket, next) => {
    try {
      const token = extractSocketToken(
        socket.handshake.auth as
          | Record<string, unknown>
          | undefined,
        socket.handshake.headers.authorization,
        socket.handshake.headers.cookie
      );

      if (!token) {
        next(
          new Error("Authentication required.")
        );
        return;
      }

      const user = await verifySocketToken(token);

      if (!user) {
        next(
          new Error("Invalid or expired session.")
        );
        return;
      }

      socket.data.user = user;

      next();
    } catch (error) {
      next(
        error instanceof Error
          ? error
          : new Error(
              "Socket authentication failed."
            )
      );
    }
  });

  io.on("connection", (socket: Socket) => {
    const authUser =
      socket.data.user as AuthUser | undefined;

    if (!authUser) {
      socket.disconnect(true);
      return;
    }

    /**
     * -------------------------------------------------------
     * JOIN ROOM
     * -------------------------------------------------------
     */
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
        if (!roomName) {
          return;
        }

        try {
          /**
           * If this socket is already inside another room,
           * clean it up before joining the new room.
           */
          const previousRoom =
            socket.data.roomName as
              | string
              | undefined;

          if (previousRoom) {
            if (previousRoom === roomName) {
              /**
               * Same-room duplicate join.
               *
               * Instead of creating another participant,
               * send current state again.
               */
              const existing =
                roomParticipants[
                  roomName
                ]?.get(socket.id);

              if (existing) {
                socket.emit(
                  "liveclass:room-users",
                  getRoomParticipants(roomName)
                );

                socket.emit(
                  "liveclass:participant-state",
                  existing
                );

                socket.emit(
                  "liveclass:joined",
                  { roomName }
                );

                return;
              }

              socket.data.roomName = undefined;
            } else {
              /**
               * Remove old room membership.
               */
              const previousParticipant =
                removeParticipantFromRoom(
                  previousRoom,
                  socket.id
                );

              socket.leave(previousRoom);

              if (previousParticipant) {
                broadcastRoomUsers(
                  io,
                  previousRoom
                );

                io.to(previousRoom).emit(
                  "liveclass:user-left",
                  {
                    id: socket.id,
                    userName:
                      previousParticipant.userName,
                  }
                );
              }

              delete participantJoinTimes[
                socket.id
              ];

              socket.data.roomName = undefined;
              socket.data.liveClassId =
                undefined;
            }
          }

          /**
           * Authorize room access using the
           * authenticated server-side user.
           */
          const liveClass =
            await assertLiveClassRoomAccess(
              authUser,
              roomName
            );

          /**
           * NEVER trust userName/userRole/studentId
           * sent by the browser.
           *
           * Load the authenticated user from DB.
           */
          const dbUser =
            await prisma.user.findUnique({
              where: {
                id: authUser.id,
              },
              select: {
                fullName: true,
                email: true,
              },
            });

          const userName =
            dbUser?.fullName?.trim() ||
            authUser.email ||
            "User";

          const userRole =
            roleLabel(authUser);

          const studentId =
            authUser.role === Role.STUDENT
              ? authUser.id
              : undefined;

          const normalizedAgoraUid =
            Number.isFinite(Number(agoraUid)) &&
            Number(agoraUid) > 0
              ? Number(agoraUid)
              : undefined;

          /**
           * Join Socket.IO room.
           */
          socket.join(roomName);

          /**
           * Load chat history.
           */
          const history =
            await loadChatHistory(
              liveClass.id
            );

          socket.emit(
            "liveclass:chat-history",
            history
          );

          socket.emit(
            "liveclass:joined",
            { roomName }
          );

          /**
           * Participant timing.
           */
          const joinTime = new Date();

          participantJoinTimes[
            socket.id
          ] = joinTime;

          /**
           * Automatically create the teacher's attendance record
           * when they join a live class. Teacher attendance uses
           * the dedicated Teacher/Staff batch marker so it appears
           * in the teacher attendance page.
           */
          if (
            isHostRole(userRole) &&
            authUser.role === Role.TEACHER
          ) {
            try {
              const todayStart = new Date();
              todayStart.setHours(0, 0, 0, 0);

              const todayEnd = new Date();
              todayEnd.setHours(23, 59, 59, 999);

              const existingAttendance =
                await prisma.attendance.findFirst({
                  where: {
                    studentId: authUser.id,
                    batchName: "Teacher/Staff",
                    batchId: liveClass.batchId,
                    date: {
                      gte: todayStart,
                      lte: todayEnd,
                    },
                    session: liveClass.title,
                  },
                });

              if (!existingAttendance) {
                const startDiffMinutes =
                  (joinTime.getTime() -
                    liveClass.scheduledStart.getTime()) /
                  (1000 * 60);

                await prisma.attendance.create({
                  data: {
                    studentId: authUser.id,
                    studentName: userName,
                    batchId: liveClass.batchId,
                    batchName: "Teacher/Staff",
                    session: liveClass.title,
                    status:
                      startDiffMinutes > 15
                        ? "LATE"
                        : "PRESENT",
                    date: joinTime,
                    remarks:
                      "Auto-marked: Joined live class.",
                  },
                });
              }
            } catch (err) {
              console.error(
                "Auto-Attendance Teacher Join Error:",
                err
              );
            }
          }

          /**
           * Store trusted socket state.
           */
          socket.data.roomName =
            roomName;

          socket.data.userName =
            userName;

          socket.data.userRole =
            userRole;

          socket.data.studentId =
            studentId;

          socket.data.liveClassId =
            liveClass.id;

          /**
           * Create room map.
           */
          if (!roomParticipants[roomName]) {
            roomParticipants[roomName] =
              new Map();
          }

          /**
           * Initial media state.
           *
           * IMPORTANT:
           * These values represent what the participant
           * says their local state is at join time.
           *
           * The frontend will immediately synchronize
           * the actual Agora track state after connecting.
           */
          const participant: Participant = {
            id: socket.id,
            userName,
            userRole,
            joinedAt:
              joinTime.toISOString(),

            studentId,

            agoraUid:
              normalizedAgoraUid,

            cameraOn: false,
            micOn: false,

            handRaised: false,
          };

          roomParticipants[
            roomName
          ].set(
            socket.id,
            participant
          );

          /**
           * Everyone gets the complete participant list.
           */
          broadcastRoomUsers(
            io,
            roomName
          );

          /**
           * Existing compatibility event.
           */
          io.to(roomName).emit(
            "liveclass:user-joined",
            participant
          );

          /**
           * If teacher/admin joins a scheduled class,
           * automatically transition it to LIVE.
           */
          if (
            isHostRole(userRole) &&
            liveClass.status ===
              "SCHEDULED"
          ) {
            const updated =
              await prisma.liveClass.update({
                where: {
                  id: liveClass.id,
                },
                data: {
                  status: "LIVE",
                },
                include: {
                  batch: {
                    select: {
                      name: true,
                      code: true,
                      courseName: true,
                      teacherId: true,
                    },
                  },
                },
              });

            io.to(roomName).emit(
              "liveclass:status-changed",
              "LIVE"
            );

            io.emit(
              "liveclass:class-updated",
              {
                ...updated,
                batchName:
                  updated.batch.name,
                batchCode:
                  updated.batch.code,
                courseName:
                  updated.batch.courseName,
              }
            );
          }
        } catch (error) {
          socket.emit(
            "liveclass:error",
            {
              message:
                error instanceof Error
                  ? error.message
                  : "Unable to join this room.",
            }
          );
        }
      }
    );

    /**
     * -------------------------------------------------------
     * USER LEAVE / DISCONNECT
     * -------------------------------------------------------
     */
    const handleUserLeave = async (
      socket: Socket
    ) => {
      /**
       * Capture everything before clearing socket data.
       */
      const roomName =
        socket.data.roomName as
          | string
          | undefined;

      const userName =
        socket.data.userName as
          | string
          | undefined;

      const userRole =
        socket.data.userRole as
          | string
          | undefined;

      const authUser =
        socket.data.user as
          | AuthUser
          | undefined;

      const joinTime =
        participantJoinTimes[
          socket.id
        ];

      /**
       * Prevent duplicate cleanup.
       *
       * This is important because explicit leave
       * can be followed by disconnect.
       */
      if (!roomName) {
        delete participantJoinTimes[
          socket.id
        ];

        delete messageRateLimit[
          socket.id
        ];

        return;
      }

      /**
       * Immediately clear socket's room state.
       */
      socket.data.roomName =
        undefined;

      socket.data.liveClassId =
        undefined;

      socket.data.userName =
        undefined;

      socket.data.userRole =
        undefined;

      socket.data.studentId =
        undefined;

      /**
       * Remove from server-side presence.
       */
      const removed =
        removeParticipantFromRoom(
          roomName,
          socket.id
        );

      if (removed) {
        broadcastRoomUsers(
          io,
          roomName
        );

        io.to(roomName).emit(
          "liveclass:user-left",
          {
            id: socket.id,
            userName:
              removed.userName ||
              userName ||
              "User",
          }
        );
      }

      delete participantJoinTimes[
        socket.id
      ];

      delete messageRateLimit[
        socket.id
      ];

      /**
       * Attendance tracking.
       */
      if (
        joinTime &&
        authUser &&
        ((
          isStudentRole(userRole) &&
          authUser.role === Role.STUDENT
        ) ||
          authUser.role === Role.TEACHER)
      ) {
        try {
          const leaveTime =
            new Date();

          const durationMinutes =
            Math.max(
              1,
              Math.round(
                (leaveTime.getTime() -
                  joinTime.getTime()) /
                  (1000 * 60)
              )
            );

          const liveClass =
            await prisma.liveClass.findUnique(
              {
                where: {
                  roomName,
                },
              }
            );

          if (liveClass) {
            const todayStart =
              new Date();

            todayStart.setHours(
              0,
              0,
              0,
              0
            );

            const todayEnd =
              new Date();

            todayEnd.setHours(
              23,
              59,
              59,
              999
            );

            const existingAttendance =
              await prisma.attendance.findFirst(
                {
                  where: {
                    studentId:
                      authUser.id,

                    batchId:
                      liveClass.batchId,

                    date: {
                      gte: todayStart,
                      lte: todayEnd,
                    },

                    session:
                      liveClass.title,

                    ...(authUser.role ===
                      Role.TEACHER
                      ? {
                          batchName:
                            "Teacher/Staff",
                        }
                      : {}),
                  },
                }
              );

            if (existingAttendance) {
              const joinTimeString =
                joinTime.toLocaleTimeString(
                  "en-US",
                  {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true,
                  }
                );

              const leaveTimeString =
                leaveTime.toLocaleTimeString(
                  "en-US",
                  {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true,
                  }
                );

              await prisma.attendance.update(
                {
                  where: {
                    id:
                      existingAttendance.id,
                  },
                  data: {
                    remarks:
                      `Auto-marked: Joined at ${joinTimeString}, Left at ${leaveTimeString} (${durationMinutes} mins attended).`,
                  },
                }
              );
            }
          }
        } catch (err) {
          console.error(
            "Auto-Attendance Leave Recording Error:",
            err
          );
        }
      }
    };

    /**
     * Explicit leave.
     */
    socket.on(
      "liveclass:leave",
      ({
        roomName,
      }: {
        roomName: string;
      }) => {
        /**
         * Only allow leaving the room this socket
         * is actually registered in.
         */
        if (
          !roomName ||
          socket.data.roomName !==
            roomName
        ) {
          return;
        }

        socket.leave(roomName);

        void handleUserLeave(
          socket
        );
      }
    );

    /**
     * -------------------------------------------------------
     * MEDIA STATE
     * -------------------------------------------------------
     *
     * Sent by every participant whenever their local
     * microphone/camera state changes.
     */
    socket.on(
      "liveclass:media-state",
      (payload: MediaStatePayload) => {
        const roomName =
          String(
            payload?.roomName || ""
          );

        if (!roomName) {
          return;
        }

        /**
         * Prevent spoofing another room.
         */
        if (
          socket.data.roomName !==
          roomName
        ) {
          return;
        }

        const room =
          roomParticipants[
            roomName
          ];

        if (!room) {
          return;
        }

        const participant =
          room.get(socket.id);

        if (!participant) {
          return;
        }

        /**
         * Update only supplied fields.
         */
        if (
          typeof payload.cameraOn ===
          "boolean"
        ) {
          participant.cameraOn =
            payload.cameraOn;
        }

        if (
          typeof payload.micOn ===
          "boolean"
        ) {
          participant.micOn =
            payload.micOn;
        }

        /**
         * Save updated participant.
         */
        room.set(
          socket.id,
          participant
        );

        /**
         * Lightweight update.
         */
        broadcastParticipantState(
          io,
          roomName,
          participant
        );

        /**
         * Also send complete state for compatibility.
         */
        broadcastRoomUsers(
          io,
          roomName
        );
      }
    );

    /**
     * -------------------------------------------------------
     * RAISE HAND
     * -------------------------------------------------------
     */
    socket.on(
      "liveclass:raise-hand",
      (payload: {
        roomName: string;
        raised?: boolean;
        senderName?: string;
      }) => {
        const roomName =
          String(
            payload?.roomName || ""
          );

        if (!roomName) {
          return;
        }

        if (
          socket.data.roomName !==
          roomName
        ) {
          return;
        }

        if (
          !isStudentRole(
            String(
              socket.data.userRole
            )
          )
        ) {
          return;
        }

        const room =
          roomParticipants[
            roomName
          ];

        if (!room) {
          return;
        }

        const participant =
          room.get(socket.id);

        if (!participant) {
          return;
        }

        const raised =
          payload.raised !== false;

        participant.handRaised =
          raised;

        room.set(
          socket.id,
          participant
        );

        /**
         * Broadcast complete participant state.
         */
        broadcastParticipantState(
          io,
          roomName,
          participant
        );

        broadcastRoomUsers(
          io,
          roomName
        );

        /**
         * Existing event retained.
         */
        io.to(roomName).emit(
          "liveclass:raise-hand",
          {
            senderName:
              participant.userName ||
              "Student",

            studentId:
              participant.studentId,

            raised,

            at:
              new Date().toISOString(),
          }
        );
      }
    );

    /**
     * -------------------------------------------------------
     * TEACHER MEDIA CONTROL
     * -------------------------------------------------------
     */
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
        const roomName =
          String(
            payload?.roomName || ""
          );

        if (!roomName) {
          return;
        }

        /**
         * Only teacher/admin can control students.
         */
        if (
          !isHostRole(
            String(
              socket.data.userRole
            )
          )
        ) {
          return;
        }

        /**
         * Sender must actually be inside
         * this room.
         */
        if (
          socket.data.roomName !==
          roomName
        ) {
          return;
        }

        if (
          payload.camera ===
            undefined &&
          payload.mic ===
            undefined
        ) {
          return;
        }

        const participants =
          roomParticipants[
            roomName
          ];

        if (!participants) {
          return;
        }

        const list =
          Array.from(
            participants.values()
          );

        /**
         * Find target.
         */
        const target =
          payload.targetSocketId
            ? participants.get(
                payload.targetSocketId
              )
            : payload.targetStudentId
              ? list.find(
                  (p) =>
                    p.studentId ===
                    payload.targetStudentId
                )
              : payload.targetAgoraUid !=
                  null
                ? list.find(
                    (p) =>
                      p.agoraUid ===
                      payload.targetAgoraUid
                  )
                : undefined;

        if (!target) {
          return;
        }

        /**
         * Teacher can control students only.
         */
        if (
          !isStudentRole(
            target.userRole
          )
        ) {
          return;
        }

        /**
         * Update server-side desired/current state.
         */
        if (
          typeof payload.camera ===
          "boolean"
        ) {
          target.cameraOn =
            payload.camera;
        }

        if (
          typeof payload.mic ===
          "boolean"
        ) {
          target.micOn =
            payload.mic;
        }

        participants.set(
          target.id,
          target
        );

        /**
         * Send command to target.
         */
        io.to(target.id).emit(
          "liveclass:media-control",
          {
            camera:
              payload.camera,
            mic: payload.mic,

            requestedBy:
              socket.data.userName ||
              "Host",
          }
        );

        /**
         * Tell everyone about the new state.
         */
        broadcastParticipantState(
          io,
          roomName,
          target
        );

        broadcastRoomUsers(
          io,
          roomName
        );
      }
    );

    /**
     * -------------------------------------------------------
     * CHAT MESSAGE
     * -------------------------------------------------------
     */
    socket.on(
      "liveclass:message",
      async (payload: {
        roomName: string;
        message: ChatMessage;
      }) => {
        if (
          !payload?.roomName ||
          !payload?.message?.text?.trim()
        ) {
          return;
        }

        /**
         * Must be inside requested room.
         */
        if (
          socket.data.roomName !==
          payload.roomName
        ) {
          socket.emit(
            "liveclass:error",
            {
              message:
                "Chat is not connected yet. Wait a moment and try again.",
            }
          );

          return;
        }

        const now =
          Date.now();

        const lastSent =
          messageRateLimit[
            socket.id
          ] || 0;

        if (
          now - lastSent <
          MESSAGE_COOLDOWN_MS
        ) {
          return;
        }

        messageRateLimit[
          socket.id
        ] = now;

        const text =
          String(
            payload.message.text
          )
            .trim()
            .slice(
              0,
              MAX_MESSAGE_LENGTH
            );

        if (!text) {
          return;
        }

        /**
         * Never trust senderName from client.
         */
        const senderName =
          String(
            socket.data.userName ||
              "User"
          );

        const liveClassId =
          socket.data.liveClassId as
            | string
            | undefined;

        const authUser =
          socket.data.user as
            | AuthUser
            | undefined;

        let saved: ChatMessage;

        try {
          if (liveClassId) {
            const row =
              await prisma.liveClassChatMessage.create(
                {
                  data: {
                    liveClassId,

                    senderId:
                      authUser?.id,

                    senderName,

                    text,
                  },
                }
              );

            saved = {
              id: row.id,
              senderName:
                row.senderName,
              text: row.text,
              sentAt:
                row.sentAt.toISOString(),
            };
          } else {
            saved = {
              id:
                payload.message.id ||
                randomUUID(),

              senderName,

              text,

              sentAt:
                new Date().toISOString(),
            };
          }
        } catch (err) {
          console.error(
            "Failed to persist chat message:",
            err
          );

          saved = {
            id:
              payload.message.id ||
              randomUUID(),

            senderName,

            text,

            sentAt:
              new Date().toISOString(),
          };
        }

        io.to(
          payload.roomName
        ).emit(
          "liveclass:message",
          saved
        );
      }
    );

    /**
     * -------------------------------------------------------
     * DISCONNECT
     * -------------------------------------------------------
     */
    socket.on(
      "disconnect",
      () => {
        void handleUserLeave(
          socket
        );
      }
    );
  });

  /**
   * ---------------------------------------------------------
   * STALE PARTICIPANT CLEANUP
   * ---------------------------------------------------------
   *
   * This is only a safety net.
   * Normal disconnect handling removes participants immediately.
   */
  setInterval(() => {
    for (const roomName of Object.keys(
      roomParticipants
    )) {
      const liveRoom =
        io.sockets.adapter.rooms.get(
          roomName
        );

      const liveSocketIds =
        liveRoom
          ? new Set(liveRoom)
          : new Set<string>();

      let changed = false;

      for (const socketId of Array.from(
        roomParticipants[
          roomName
        ].keys()
      )) {
        if (
          !liveSocketIds.has(
            socketId
          )
        ) {
          roomParticipants[
            roomName
          ].delete(socketId);

          delete participantJoinTimes[
            socketId
          ];

          delete messageRateLimit[
            socketId
          ];

          changed = true;
        }
      }

      if (
        roomParticipants[
          roomName
        ].size === 0
      ) {
        delete roomParticipants[
          roomName
        ];

        continue;
      }

      if (changed) {
        broadcastRoomUsers(
          io,
          roomName
        );
      }
    }
  }, 30000);
}