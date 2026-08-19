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
import supportRoutes from "./modules/support/support.routes";
import studentEventRoutes from "./modules/student/student.event.routes";
import studentCompetitionRoutes from "./modules/student/student.competition.routes";
import studentOfferRoutes from "./modules/student/student.offer.routes";
import teacherRoutes from "./modules/teacher/teacher.routes";
import liveClassRoutes from "./modules/liveclass/liveclass.routes";
import videoRoutes from "./modules/video/video.routes";
import contentRoutes from "./modules/content/content.routes";
import recordedClassRoutes from "./modules/admin/recordedClass.routes";
import exmRoutes from "./modules/admin/exam.routes";
import studentExamRoutes from "./modules/student/student.exam.routes";
import { notificationRoutes } from "./modules/notification/notification.routes";
import paymentRoutes from "./modules/payment/payment.routes";
import attendanceRoutes from "./modules/attendance/attendance.routes"; 
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
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import { authenticate } from "./middleware/auth.middleware";

const app = express();

app.use(helmet());
app.use(cors({
  origin: env.frontendUrl,
  credentials: true,
}));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

const uploadsDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use("/uploads", express.static(uploadsDir));

app.get("/api/v1/health", (req: Request, res: Response) => {
  res.json({
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
app.use("/api/v1/student/events", studentEventRoutes);
app.use("/api/v1/student/competition", studentCompetitionRoutes);
app.use("/api/v1/student/offers", studentOfferRoutes);
app.use("/api/v1/teacher", teacherRoutes);
app.use("/api/v1/support", supportRoutes);
app.use("/api/v1", liveClassRoutes);
app.use("/api/v1/video", videoRoutes);
app.use("/api/v1/content", contentRoutes);
app.use("/api/v1", recordedClassRoutes);
app.use("/api/v1/admin/exams", exmRoutes);
app.use("/api/v1/student/exams", studentExamRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/payment", paymentRoutes);
app.use("/api/v1/attendance", attendanceRoutes); // Attendance routes
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
app.use("/api/v1/exams", exmRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
