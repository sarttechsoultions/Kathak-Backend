import { Router } from "express";
import { Permission, Role } from "@prisma/client";
import { authenticate, requirePermission, requireRole } from "../../middleware/auth.middleware";
import { requireActiveStudentAccess } from "../../middleware/access.middleware";
import {
  createRecordedClass,
  deleteRecordedClass,
  getAdminRecordedClassById,
  getAdminRecordedClasses,
  getStudentRecordedClasses,
  getStudentSingleRecordedClass,
  recordClassView,
} from "./recordedClass.controller";

const router = Router();

router.get(
  "/admin/recorded-classes",
  authenticate,
  requirePermission(Permission.MANAGE_RECORDED_CLASSES),
  getAdminRecordedClasses
);
router.get(
  "/admin/recorded-classes/:id",
  authenticate,
  requirePermission(Permission.MANAGE_RECORDED_CLASSES),
  getAdminRecordedClassById
);
router.post(
  "/admin/recorded-classes",
  authenticate,
  requirePermission(Permission.MANAGE_RECORDED_CLASSES),
  createRecordedClass
);
router.delete(
  "/admin/recorded-classes/:id",
  authenticate,
  requirePermission(Permission.MANAGE_RECORDED_CLASSES),
  deleteRecordedClass
);

router.get(
  "/student/recorded-classes",
  authenticate,
  requireRole(Role.STUDENT),
  requireActiveStudentAccess,
  getStudentRecordedClasses
);
router.get(
  "/student/recorded-classes/:id",
  authenticate,
  requireRole(Role.STUDENT),
  requireActiveStudentAccess,
  getStudentSingleRecordedClass
);
router.post(
  "/student/recorded-classes/:id/view",
  authenticate,
  requireRole(Role.STUDENT),
  requireActiveStudentAccess,
  recordClassView
);

export default router;
