import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, requireRole } from "../../middleware/auth.middleware";
import { 
  getBatchAttendance, 
  getTeacherAttendance, 
  saveBulkAttendance,
  getAttendanceReport
} from "./attendance.controller";

const router = Router();

// Admin aur Teacher dono attendance dekh aur mark kar sakte hain
router.get("/batch", authenticate, requireRole(Role.ADMIN, Role.TEACHER), getBatchAttendance);
router.get("/teachers", authenticate, requireRole(Role.ADMIN), getTeacherAttendance);
router.post("/bulk-save", authenticate, requireRole(Role.ADMIN, Role.TEACHER), saveBulkAttendance);
router.get("/report", authenticate, requireRole(Role.ADMIN, Role.TEACHER), getAttendanceReport); 

export default router;