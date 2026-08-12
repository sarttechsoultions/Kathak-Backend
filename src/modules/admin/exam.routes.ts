import { Router } from "express";
import { Permission } from "@prisma/client";
import { authenticate, requirePermission } from "../../middleware/auth.middleware";
import {
  getExams,
  createExam,
  getExamResults,
  evaluateExamResult
} from "./exam.controller";

const router = Router();

// Sabhi exam routes ko authenticate karein
router.use(authenticate);


router.get("/", requirePermission(Permission.VIEW_EXAMS), getExams);
router.post("/", requirePermission(Permission.CREATE_EXAM), createExam);
router.get("/results", requirePermission(Permission.VIEW_EXAM_RESULTS), getExamResults);
router.post("/results/:id/evaluate", requirePermission(Permission.GRADE_EXAMS), evaluateExamResult);

export default router;