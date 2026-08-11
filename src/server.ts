import { createServer } from "http";
import { Server } from "socket.io";
import app from "./app";
import { env } from "./config/env";
import { registerLiveClassSocket } from "./modules/liveclass/liveclass.socket";

const httpServer = createServer(app);

const allowedOrigins = [
  env.frontendUrl,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

registerLiveClassSocket(io);

const PORT = env.port || 5000;

httpServer.listen(PORT, () => {
  console.log(`🚀 Kathak Next Backend Server listening on http://localhost:${PORT}`);
});