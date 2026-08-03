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
import {
  getCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  getInquiries,
  updateInquiryStatus,
  deleteInquiry,
  getStudents,
  getTeachers,
  getBatches,
  getAttendanceRecords,
  getPayments
} from "./modules/admin/admin.controller";
import { authenticate } from "./middleware/auth.middleware";
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

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/upload", uploadRoutes);
app.use("/api/v1/student", studentRoutes);
app.use("/api/v1", liveClassRoutes);

// Public & Universal Module Route Aliases
app.get("/api/v1/courses", getCourses);
app.post("/api/v1/courses", authenticate, createCourse);
app.put("/api/v1/courses/:id", authenticate, updateCourse);
app.delete("/api/v1/courses/:id", authenticate, deleteCourse);

app.get("/api/v1/inquiries", authenticate, getInquiries);
app.patch("/api/v1/inquiries/:id", authenticate, updateInquiryStatus);
app.delete("/api/v1/inquiries/:id", authenticate, deleteInquiry);

app.get("/api/v1/students", authenticate, getStudents);
app.get("/api/v1/teachers", authenticate, getTeachers);
app.get("/api/v1/batches", authenticate, getBatches);
app.get("/api/v1/attendance", authenticate, getAttendanceRecords);
app.get("/api/v1/finance", authenticate, getPayments);
app.get("/api/v1/payments", authenticate, getPayments);

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