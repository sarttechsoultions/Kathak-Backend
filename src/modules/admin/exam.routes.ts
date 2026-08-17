import { Router } from "express";
import { Permission } from "@prisma/client";
import { authenticate, requirePermission } from "../../middleware/auth.middleware";
import {
  getExams,
  createExam,
  getExamResults,
  evaluateExamResult,
  getExamStudents
} from "./exam.controller";

const router = Router();

// Sabhi exam routes ko authenticate karein
router.use(authenticate);

// ==========================================
// ROUTES
// ==========================================

// 1. Get all exams
router.get("/", requirePermission(Permission.VIEW_EXAMS), getExams);

// 2. Create a new exam
router.post("/", requirePermission(Permission.CREATE_EXAM), createExam);

// 3. Get all exam results
// FIX: Changed from VIEW_EXAM_RESULTS to VIEW_EXAMS (Controller handles isolation)
router.get("/results", requirePermission(Permission.VIEW_EXAMS), getExamResults);

// 4. Grade / Evaluate a specific student's exam
// FIX: Changed from GRADE_EXAMS to VIEW_EXAMS (Controller handles ownership check)
router.post("/results/:id/evaluate", requirePermission(Permission.VIEW_EXAMS), evaluateExamResult);

// 5. Get list of students for a specific exam
// FIX: Changed from VIEW_EXAM_RESULTS to VIEW_EXAMS
router.get("/:id/students", requirePermission(Permission.VIEW_EXAMS), getExamStudents);

export default router;