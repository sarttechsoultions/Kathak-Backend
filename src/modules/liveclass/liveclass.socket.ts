import { Server, Socket } from "socket.io";

type ChatMessage = { id: string; senderName: string; text: string; sentAt: string };
type Participant = { id: string; userName: string; userRole: string; joinedAt: string };

const roomParticipants: Record<string, Map<string, Participant>> = {};
const roomChatHistory: Record<string, ChatMessage[]> = {};

export function registerLiveClassSocket(io: Server) {
  io.on("connection", (socket: Socket) => {

    socket.on("liveclass:join", ({ roomName, userName, userRole }: { roomName: string; userName?: string; userRole?: string }) => {
      if (roomName) {
        socket.join(roomName);

        // Always send room chat history snapshot to the joining user
        if (roomChatHistory[roomName]) {
          socket.emit("liveclass:chat-history", roomChatHistory[roomName]);
        } else {
          roomChatHistory[roomName] = [];
          socket.emit("liveclass:chat-history", []);
        }

        if (userName) {
          socket.data.roomName = roomName;
          socket.data.userName = userName;
          socket.data.userRole = userRole || "Student";
          
          if (!roomParticipants[roomName]) {
            roomParticipants[roomName] = new Map();
          }

          const participant: Participant = {
            id: socket.id,
            userName,
            userRole: userRole || "Student",
            joinedAt: new Date().toISOString()
          };

          roomParticipants[roomName].set(userName, participant);

          // Emit full room participants snapshot to all users in the room
          const currentList = Array.from(roomParticipants[roomName].values());
          io.to(roomName).emit("liveclass:room-users", currentList);
          io.to(roomName).emit("liveclass:user-joined", participant);
        }
      }
    });

    socket.on("liveclass:leave", ({ roomName }: { roomName: string }) => {
      if (roomName) {
        socket.leave(roomName);
        if (socket.data.userName && roomParticipants[roomName]) {
          roomParticipants[roomName].delete(socket.data.userName);
          const currentList = Array.from(roomParticipants[roomName].values());
          io.to(roomName).emit("liveclass:room-users", currentList);
          io.to(roomName).emit("liveclass:user-left", {
            id: socket.id,
            userName: socket.data.userName
          });
        }
      }
    });

    socket.on("liveclass:message", (payload: { roomName: string; message: ChatMessage }) => {
      if (!payload?.roomName || !payload?.message) return;
      socket.join(payload.roomName);

      if (!roomChatHistory[payload.roomName]) {
        roomChatHistory[payload.roomName] = [];
      }
      
      // Store message in memory history if not already present
      if (!roomChatHistory[payload.roomName].some((m) => m.id === payload.message.id)) {
        roomChatHistory[payload.roomName].push(payload.message);
      }

      // Broadcast message to all participants in the room
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
      const roomName = socket.data.roomName;
      const userName = socket.data.userName;
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
          userName: userName || "User"
        });
      }
    });

  });
}