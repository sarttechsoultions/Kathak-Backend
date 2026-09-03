import { Router } from "express";
import { Role } from "@prisma/client";
import {
  authenticate,
  requireRole,
} from "../../middleware/auth.middleware";

import {
  getTeacherSettings,
  updateTeacherProfile,
  updateTeacherSecurity,
  updateNotificationPrefs,
} from "./teacher.settings.controller";

import { getTeacherDashboard } from "./teacher.dashboard.controller";

import {
  getTeacherBatches,
  getTeacherBatchStudents,
} from "./teacher.batches.controller";

import {
  getTeacherProgressHub,
  getTeacherStudentProgress,
} from "./teacher.progress.controller";

import {
  applyTeacherLeave,
  getTeacherAttendance,
} from "./teacher.attendance.controller";

import {
  getExams,
  createExam,
  getExamResults,
  getExamResultDetail,
  evaluateExamResult,
  getExamStudents,
} from "../admin/exam.controller";

const router = Router();

/* -------------------------------------------------------------------------- */
/* Authentication & Role                                                     */
/* -------------------------------------------------------------------------- */

router.use(authenticate);

router.use(
  requireRole(
    Role.TEACHER,
    Role.ADMIN
  )
);

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                 */
/* -------------------------------------------------------------------------- */

router.get(
  "/dashboard",
  getTeacherDashboard
);

/* -------------------------------------------------------------------------- */
/* Batches                                                                    */
/* -------------------------------------------------------------------------- */

router.get(
  "/batches",
  getTeacherBatches
);

router.get(
  "/batches/:batchId/students",
  getTeacherBatchStudents
);

/* -------------------------------------------------------------------------- */
/* Progress                                                                   */
/* -------------------------------------------------------------------------- */

router.get(
  "/progress",
  getTeacherProgressHub
);

router.get(
  "/progress/:studentId",
  getTeacherStudentProgress
);

/* -------------------------------------------------------------------------- */
/* Attendance                                                                 */
/* -------------------------------------------------------------------------- */

router.get(
  "/attendance",
  getTeacherAttendance
);

router.post(
  "/leave",
  applyTeacherLeave
);

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

router.get(
  "/settings",
  getTeacherSettings
);

router.put(
  "/settings/profile",
  updateTeacherProfile
);

router.put(
  "/settings/security",
  updateTeacherSecurity
);

router.put(
  "/settings/notifications",
  updateNotificationPrefs
);

/* -------------------------------------------------------------------------- */
/* Exam Routes                                                                */
/*                                                                            */
/* IMPORTANT: These controllers are shared with Admin.                        */
/* Teacher access is isolated inside the exam controller using teacher       */
/* batch authorization.                                                       */
/* -------------------------------------------------------------------------- */

router.get(
  "/exams",
  getExams
);

router.post(
  "/exams",
  createExam
);

/* Exam Results List */
router.get(
  "/exams/results",
  getExamResults
);

/* Exam Result Detail */
router.get(
  "/exams/results/:id",
  getExamResultDetail
);

/* Evaluate / Update Exam Result */
router.post(
  "/exams/results/:id/evaluate",
  evaluateExamResult
);

/* Students of an Exam */
router.get(
  "/exams/:id/students",
  getExamStudents
);

export default router;