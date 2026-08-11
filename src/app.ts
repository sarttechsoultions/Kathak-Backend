import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import fs from "fs";
import "./types/auth";
import authRoutes from "./modules/auth/auth.routes";
import adminRoutes from "./modules/admin/admin.routes";
import uploadRoutes from "./modules/upload/upload.routes";
import studentRoutes from "./modules/student/student.routes";
import liveClassRoutes from "./modules/liveclass/liveclass.routes";
import videoRoutes from "./modules/video/video.routes";
import recordedClassRoutes from "./modules/admin/recordedClass.routes";
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

const app = express();

app.disable("x-powered-by");

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

const allowedOrigins = [
  env.frontendUrl,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS policy violation: Access denied."));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(generalRateLimiter);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Ensure uploads directory exists and is served statically
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use("/uploads", express.static(uploadsDir));

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
app.use("/api/v1/video", videoRoutes);
app.use("/api/v1", recordedClassRoutes);

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

export default app;