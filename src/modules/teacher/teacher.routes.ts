import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, requireRole } from "../../middleware/auth.middleware";
import { 
  getTeacherSettings, 
  updateTeacherProfile, 
  updateTeacherSecurity, 
  updateNotificationPrefs 
} from "./teacher.settings.controller";
import {
  getExams,
  createExam,
  getExamResults,
  evaluateExamResult,
  getExamStudents,
} from "../admin/exam.controller";

const router = Router();

// Secure all teacher routes
router.use(authenticate);
router.use(requireRole(Role.TEACHER, Role.ADMIN));

// Settings Routes
router.get("/settings", getTeacherSettings);
router.put("/settings/profile", updateTeacherProfile);
router.put("/settings/security", updateTeacherSecurity);
router.put("/settings/notifications", updateNotificationPrefs);

// Exam Routes for Teacher (Controller internally isolates by Teacher's assigned batches)
router.get("/exams", getExams);
router.post("/exams", createExam);
router.get("/exams/results", getExamResults);
router.post("/exams/results/:id/evaluate", evaluateExamResult);
router.get("/exams/:id/students", getExamStudents);

export default router;
