import { Router } from "express";
import { Permission, Role } from "@prisma/client";
import { authenticate, requirePermission, requireRole } from "../../middleware/auth.middleware";
import { createLiveClass, getLiveClassToken, listAdminLiveClasses, listStudentLiveClasses, listTeacherLiveClasses, setLiveClassStatus } from "./liveclass.controller";
const router = Router();

router.get("/admin/classes", authenticate, requirePermission(Permission.MANAGE_CLASSES), listAdminLiveClasses);
router.post("/admin/classes", authenticate, requirePermission(Permission.MANAGE_CLASSES), createLiveClass);
router.patch("/admin/classes/:id/status", authenticate, requirePermission(Permission.START_LIVE_CLASS), setLiveClassStatus);

router.get("/teacher/classes", authenticate, requireRole(Role.TEACHER, Role.ADMIN), listTeacherLiveClasses);
router.patch("/teacher/classes/:id/status", authenticate, requireRole(Role.TEACHER, Role.ADMIN), setLiveClassStatus);
router.get("/student/classes", authenticate, requireRole(Role.STUDENT), listStudentLiveClasses);

router.get("/classes/:id/join-token", authenticate, requireRole(Role.ADMIN, Role.TEACHER, Role.STUDENT), getLiveClassToken);

export default router;
