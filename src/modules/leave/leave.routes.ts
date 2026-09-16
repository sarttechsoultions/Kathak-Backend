import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, requireRole } from "../../middleware/auth.middleware";
import {
  getAdminLeaveRequests,
  getTeacherStudentLeaveRequests,
  reviewLeaveRequest,
} from "./leave.controller";

const router = Router();

router.get("/admin/leave-requests", authenticate, requireRole(Role.ADMIN), getAdminLeaveRequests);
router.patch("/admin/leave-requests/:id", authenticate, requireRole(Role.ADMIN), reviewLeaveRequest);
router.get("/teacher/leave-requests", authenticate, requireRole(Role.TEACHER, Role.ADMIN), getTeacherStudentLeaveRequests);

export default router;
