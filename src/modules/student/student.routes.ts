import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, requireRole } from "../../middleware/auth.middleware";
import { requireActiveStudentAccess } from "../../middleware/access.middleware";
import { logoutUser } from "../auth/auth.controller";
import { studentCertificateRouter } from "../certificate/certificate.routes";
import { createSupportTicket } from "../support/support.controller";
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
  getStudentPaymentReceipt,
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
  getStudentLeaveRequests,
  getStudentProgress,
  initiateUpgrade,
  verifyUpgrade,
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

router.use("/certificates", studentCertificateRouter);

router.post("/logout", ...studentOnly, logoutUser);

router.post("/upgrade/initiate", ...studentOnly, initiateUpgrade);
router.post("/upgrade/verify", ...studentOnly, verifyUpgrade);

// Dashboard & Analytics
router.get("/dashboard", ...studentOnly, getStudentDashboard);

// Attendance, Progress & Leave
router.get("/attendance", ...studentOnly, getStudentAttendance);
router.post("/leave", ...studentOnly, requireActiveStudentAccess, applyStudentLeave);
router.get("/leave", ...studentOnly, getStudentLeaveRequests);
router.get("/progress", ...studentOnly, requireActiveStudentAccess, getStudentProgress);

router.get("/profile", ...studentOnly, getStudentProfile);
router.put("/profile", ...studentOnly, updateStudentProfile);
router.post("/profile/change-password", ...studentOnly, changeStudentPassword);
router.get("/settings", ...studentOnly, getStudentSettings);
router.put("/settings/profile", ...studentOnly, updateStudentSettingsProfile);
router.put("/settings/notifications", ...studentOnly, updateStudentSettingsNotifications);
router.get("/finance", ...studentOnly, getStudentFinance);
router.get("/finance/payments/:paymentId/receipt", ...studentOnly, getStudentPaymentReceipt);
router.get("/assignments", ...studentOnly, getStudentAssignments);
router.post("/assignments/submit", ...studentOnly, requireActiveStudentAccess, submitStudentAssignment);

// Mobile and web student clients can submit a support query without supplying
// a student ID; the authenticated token determines the ticket owner.
router.post("/support/query", ...studentOnly, createSupportTicket);

// Legacy exam routes removed to prevent shadowing studentExamRoutes in app.ts

export default router;
