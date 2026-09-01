import { createServer } from "http";
import { Server } from "socket.io";
import app from "./app";
import { env } from "./config/env";
import { registerLiveClassSocket } from "./modules/liveclass/liveclass.socket";
import { setIO } from "./lib/socket";
import { startClassExpiryJob } from "./modules/scheduler/expireClasses";


const httpServer = createServer(app);

const allowedOrigins = [
  env.frontendUrl,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "https://kathak-theta.vercel.app"
];

const io = new Server(httpServer, {
  
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});
setIO(io);

registerLiveClassSocket(io);

const PORT = env.port || 5000;

httpServer.listen(PORT, () => {
  console.log(`🚀 Kathak Next Backend Server listening on http://localhost:${PORT}`);
});
startClassExpiryJob();
