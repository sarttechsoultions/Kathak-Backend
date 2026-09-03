import { Router } from "express";
import { Permission } from "@prisma/client";
import {
  authenticate,
  requirePermission,
} from "../../middleware/auth.middleware";

import {
  getExams,
  createExam,
  getExamResults,
  getExamResultDetail,
  evaluateExamResult,
  getExamStudents,
} from "./exam.controller";

const router = Router();

router.use(authenticate);

// ==========================================
// EXAMS
// ==========================================

router.get(
  "/",
  requirePermission(Permission.VIEW_EXAMS),
  getExams
);

router.post(
  "/",
  requirePermission(Permission.CREATE_EXAM),
  createExam
);

// ==========================================
// RESULTS
// ==========================================

// All results
router.get(
  "/results",
  requirePermission(Permission.VIEW_EXAMS),
  getExamResults
);

// Specific result details
// IMPORTANT: This route was missing earlier.
router.get(
  "/results/:id",
  requirePermission(Permission.VIEW_EXAMS),
  getExamResultDetail
);

// Evaluate / update result
router.post(
  "/results/:id/evaluate",
  requirePermission(Permission.VIEW_EXAMS),
  evaluateExamResult
);

// ==========================================
// EXAM STUDENTS
// ==========================================

router.get(
  "/:id/students",
  requirePermission(Permission.VIEW_EXAMS),
  getExamStudents
);

export default router;