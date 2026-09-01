import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, requireRole } from "../../middleware/auth.middleware";
import { logoutUser } from "../auth/auth.controller";
import {
  enrollStudent,
  enrollStudentBypass,
  sendStudentOtp,
  verifyStudentOtp,
  getStudentProfile,
  updateStudentProfile,
  changeStudentPassword,
  studentLogin,
  getStudentFinance,
  getStudentAssignments,
  submitStudentAssignment,
  getStudentExams,
  getStudentExamById,
  submitStudentExam,
  getStudentDashboard,
  getPublicCourses,
  getPublicMarketingCourses,
  getPublicMarketingCourseBySlug,
  getStudentAttendance,
  applyStudentLeave,
  getStudentProgress
} from "./student.controller";
import {
  getStudentSettings,
  updateStudentSettingsProfile,
  updateStudentSettingsNotifications,
  sendStudentForgotPasswordOtp,
  resetStudentForgotPassword,
} from "./student.settings.controller";

const router = Router();

router.post("/login", studentLogin);
router.post("/enroll", enrollStudent);
router.post("/enroll/bypass", enrollStudentBypass);
router.post("/otp/send", sendStudentOtp);
router.post("/otp/verify", verifyStudentOtp);
router.post("/forgot-password/send-otp", sendStudentForgotPasswordOtp);
router.post("/forgot-password/reset", resetStudentForgotPassword);
router.get("/public/courses/marketing/:slug", getPublicMarketingCourseBySlug);
router.get("/public/courses/marketing", getPublicMarketingCourses);
router.get("/public/courses", getPublicCourses);

// Protected student routes
const studentOnly = [authenticate, requireRole(Role.STUDENT)];

router.post("/logout", ...studentOnly, logoutUser);



// Dashboard & Analytics
router.get("/dashboard", ...studentOnly, getStudentDashboard);

// Attendance, Progress & Leave
router.get("/attendance", ...studentOnly, getStudentAttendance);
router.post("/leave", ...studentOnly, applyStudentLeave);
router.get("/progress", ...studentOnly, getStudentProgress);

router.get("/profile", ...studentOnly, getStudentProfile);
router.put("/profile", ...studentOnly, updateStudentProfile);
router.post("/profile/change-password", ...studentOnly, changeStudentPassword);
router.get("/settings", ...studentOnly, getStudentSettings);
router.put("/settings/profile", ...studentOnly, updateStudentSettingsProfile);
router.put("/settings/notifications", ...studentOnly, updateStudentSettingsNotifications);
router.get("/finance", ...studentOnly, getStudentFinance);
router.get("/assignments", ...studentOnly, getStudentAssignments);
router.post("/assignments/submit", ...studentOnly, submitStudentAssignment);

// Legacy exam routes removed to prevent shadowing studentExamRoutes in app.ts

export default router;