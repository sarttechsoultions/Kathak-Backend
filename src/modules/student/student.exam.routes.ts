import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import {
  getMyExams,
  getExamToAttempt,
  submitExam,
  getMyResultDetails
} from "./student.exam.controller";

const router = Router();

// Sabhi student exam routes ko authenticate karein
router.use(authenticate);

// Student Exam Routes
router.get("/", getMyExams);                           // Get list of exams
router.get("/:id/attempt", getExamToAttempt);          // Get exam questions
router.post("/:id/submit", submitExam);                // Submit exam
router.get("/result/:resultId", getMyResultDetails);   // View exact result & feedback

export default router;