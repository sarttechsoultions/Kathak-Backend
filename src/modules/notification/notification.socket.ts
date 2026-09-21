import { Server, Socket } from "socket.io";
import { AuthUser } from "../../types/auth";

export function registerNotificationSocket(io: Server) {
  io.on("connection", (socket: Socket) => {
    const authUser = socket.data.user as AuthUser | undefined;

    if (!authUser) {
      // Disconnect if user is not authenticated. The middleware in liveclass.socket.ts 
      // or server.ts should have populated this.
      socket.disconnect(true);
      return;
    }

    // Join a unique room for this user so we can emit targeted notifications
    const userRoom = `user:${authUser.id}`;
    socket.join(userRoom);
    
    // You can optionally log or handle other notification-related socket events here
    
    socket.on("disconnect", () => {
      // Automatic cleanup happens by socket.io
    });
  });
}
