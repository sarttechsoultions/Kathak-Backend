import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { createServer } from "http";
import { Server } from "socket.io";
import "./types/auth";
import authRoutes from "./modules/auth/auth.routes";
import adminRoutes from "./modules/admin/admin.routes";
import uploadRoutes from "./modules/upload/upload.routes";
import studentRoutes from "./modules/student/student.routes";
import liveClassRoutes from "./modules/liveclass/liveclass.routes";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import { generalRateLimiter } from "./middleware/rateLimit.middleware";
import { registerLiveClassSocket } from "./modules/liveclass/liveclass.socket";


const app = express();

app.disable("x-powered-by");

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

app.use(cors({
  origin: env.frontendUrl,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(generalRateLimiter);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.get("/api/v1/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "success",
    message: "Kathak Next Express Backend API is running smoothly!",
    timestamp: new Date().toISOString(),
    environment: env.nodeEnv,
  });
});

import { getCourses } from "./modules/admin/admin.controller";

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/upload", uploadRoutes);
app.use("/api/v1/student", studentRoutes);
app.use("/api/v1", liveClassRoutes);
app.get("/api/v1/courses", getCourses);

app.use(notFoundHandler);
app.use(errorHandler);

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: env.frontendUrl,
    credentials: true,
  },
});

registerLiveClassSocket(io);

httpServer.listen(env.port, () => {
  console.log(` Environment: ${env.nodeEnv}`);
  console.log(` Server (HTTP + Socket.io) listening on port ${env.port}`);
});