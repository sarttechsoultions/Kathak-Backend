import { Router } from "express";
import { Permission } from "@prisma/client";
import {
  getDashboardStats,
  getStudents,
  createStudent,
  deleteStudent,
  getTeachers,
  createTeacher,
  updateTeacher,
  deleteTeacher,
  getBatches,
  createBatch,
  updateBatch,
  deleteBatch,
  getBatchStudents,
  getCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  getAttendanceRecords,
  saveAttendance
} from "./admin.controller";
import { authenticate, requirePermission } from "../../middleware/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/dashboard", requirePermission(Permission.VIEW_DASHBOARD), getDashboardStats);
router.get("/students", requirePermission(Permission.MANAGE_STUDENTS), getStudents);
router.post("/students", requirePermission(Permission.MANAGE_STUDENTS), createStudent);
router.delete("/students/:id", requirePermission(Permission.MANAGE_STUDENTS), deleteStudent);
router.get("/teachers", requirePermission(Permission.MANAGE_TEACHERS), getTeachers);
router.post("/teachers", requirePermission(Permission.MANAGE_TEACHERS), createTeacher);
router.put("/teachers/:id", requirePermission(Permission.MANAGE_TEACHERS), updateTeacher);
router.delete("/teachers/:id", requirePermission(Permission.MANAGE_TEACHERS), deleteTeacher);

// Course Management Routes
router.get("/courses", requirePermission(Permission.MANAGE_COURSES), getCourses);
router.post("/courses", requirePermission(Permission.MANAGE_COURSES), createCourse);
router.put("/courses/:id", requirePermission(Permission.MANAGE_COURSES), updateCourse);
router.delete("/courses/:id", requirePermission(Permission.MANAGE_COURSES), deleteCourse);

// Batch Management Routes with Fine-Grained Permissions
router.get("/batches", requirePermission(Permission.MANAGE_BATCHES), getBatches);
router.post("/batches", requirePermission(Permission.MANAGE_BATCHES), createBatch);
router.put("/batches/:id", requirePermission(Permission.MANAGE_BATCHES), updateBatch);
router.delete("/batches/:id", requirePermission(Permission.MANAGE_BATCHES), deleteBatch);
router.get("/batches/:id/students", requirePermission(Permission.MANAGE_BATCHES), getBatchStudents);

// Attendance Management Routes
router.get("/attendance", requirePermission(Permission.MANAGE_ATTENDANCE), getAttendanceRecords);
router.post("/attendance", requirePermission(Permission.MANAGE_ATTENDANCE), saveAttendance);

export default router;
