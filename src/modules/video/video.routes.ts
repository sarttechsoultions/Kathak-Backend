import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth.middleware";
import {
  getDirectory,
  getStudentHistory,
  getVideoTasks,
  createVideoTask,
  evaluateVideoSubmission,
  submitStudentVideo,
  getTeacherAssignedCoursesAndBatches,
  getTaskSubmissionsDetail,
} from "./video.controller";

const router = Router();

router.use(authenticate);

router.get("/directory", getDirectory);
router.get("/tasks", getVideoTasks);
router.get("/tasks/:taskId/submissions", requireRole("ADMIN", "TEACHER"), getTaskSubmissionsDetail);
router.get("/teacher/assigned-courses-batches", requireRole("ADMIN", "TEACHER"), getTeacherAssignedCoursesAndBatches);
router.get("/student/:studentId/history", getStudentHistory);
router.post("/tasks", requireRole("ADMIN", "TEACHER"), createVideoTask);
router.post("/evaluate/:submissionId", requireRole("ADMIN", "TEACHER"), evaluateVideoSubmission);
router.post("/student/submit", requireRole("STUDENT", "ADMIN", "TEACHER"), submitStudentVideo);

export default router;
