import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, requireRole } from "../../middleware/auth.middleware";
import { logoutUser } from "../auth/auth.controller";
import {
  enrollStudent,
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
  getPublicCourses
} from "./student.controller";

const router = Router();

router.post("/login", studentLogin);
router.post("/enroll", enrollStudent);
router.get("/public/courses", getPublicCourses);

// Protected student routes
const studentOnly = [authenticate, requireRole(Role.STUDENT)];

router.post("/logout", ...studentOnly, logoutUser);

router.get("/dashboard", ...studentOnly, getStudentDashboard);
router.get("/profile", ...studentOnly, getStudentProfile);
router.put("/profile", ...studentOnly, updateStudentProfile);
router.post("/profile/change-password", ...studentOnly, changeStudentPassword);
router.get("/finance", ...studentOnly, getStudentFinance);
router.get("/assignments", ...studentOnly, getStudentAssignments);
router.post("/assignments/submit", ...studentOnly, submitStudentAssignment);

router.get("/exams", ...studentOnly, getStudentExams);
router.get("/exams/:id", ...studentOnly, getStudentExamById);
router.post("/exams/submit", ...studentOnly, submitStudentExam);

export default router;