import { Router } from "express";
import { Permission } from "@prisma/client";
import {
  getDashboardStats,
  getStudents,
  getStudentById,
  createStudent,
  updateStudent,
  changeStudentStatus,
  resetStudentPassword,
  deleteStudent,
  assignStudentBatch,
  removeStudentBatch,
  getBatchStudents,
  getTeachers,
  getTeacherById,
  createTeacher,
  updateTeacher,
  deleteTeacher,
  getCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  addLesson,
  deleteLesson,
  getBatches,
  createBatch,
  updateBatch,
  deleteBatch,
  getAttendanceRecords,
  saveAttendance,
  getPayments,
  refundPayment,
  getInquiries,
  updateInquiryStatus,
  deleteInquiry,
  getAdminProfile,
  updateAdminProfile,
  changeAdminPassword
} from "./admin.controller";
import { authenticate, requirePermission } from "../../middleware/auth.middleware";

const router = Router();

router.use(authenticate);

// 1. Dashboard Overview
router.get("/dashboard", requirePermission(Permission.VIEW_DASHBOARD), getDashboardStats);

// 2. Student Management
router.get("/students", requirePermission(Permission.MANAGE_STUDENTS), getStudents);
router.post("/students", requirePermission(Permission.MANAGE_STUDENTS), createStudent);
router.get("/students/:id", requirePermission(Permission.MANAGE_STUDENTS), getStudentById);
router.put("/students/:id", requirePermission(Permission.MANAGE_STUDENTS), updateStudent);
router.patch("/students/:id/status", requirePermission(Permission.MANAGE_STUDENTS), changeStudentStatus);
router.post("/students/:id/reset-password", requirePermission(Permission.MANAGE_STUDENTS), resetStudentPassword);
router.delete("/students/:id", requirePermission(Permission.MANAGE_STUDENTS), deleteStudent);
router.post("/students/:id/batches", requirePermission(Permission.MANAGE_STUDENTS), assignStudentBatch);
router.delete("/students/:id/batches/:batchId", requirePermission(Permission.MANAGE_STUDENTS), removeStudentBatch);

// 3. Teacher Management
router.get("/teachers", requirePermission(Permission.MANAGE_TEACHERS), getTeachers);
router.get("/teachers/:id", requirePermission(Permission.MANAGE_TEACHERS), getTeacherById);
router.post("/teachers", requirePermission(Permission.MANAGE_TEACHERS), createTeacher);
router.put("/teachers/:id", requirePermission(Permission.MANAGE_TEACHERS), updateTeacher);
router.delete("/teachers/:id", requirePermission(Permission.MANAGE_TEACHERS), deleteTeacher);

// 4. Course & Lesson Management
router.get("/courses", requirePermission(Permission.MANAGE_COURSES), getCourses);
router.post("/courses", requirePermission(Permission.MANAGE_COURSES), createCourse);
router.put("/courses/:id", requirePermission(Permission.MANAGE_COURSES), updateCourse);
router.delete("/courses/:id", requirePermission(Permission.MANAGE_COURSES), deleteCourse);
router.post("/courses/:id/lessons", requirePermission(Permission.MANAGE_COURSES), addLesson);
router.delete("/courses/:id/lessons/:lessonId", requirePermission(Permission.MANAGE_COURSES), deleteLesson);

// 5. Batch Management
router.get("/batches", requirePermission(Permission.MANAGE_BATCHES), getBatches);
router.post("/batches", requirePermission(Permission.MANAGE_BATCHES), createBatch);
router.put("/batches/:id", requirePermission(Permission.MANAGE_BATCHES), updateBatch);
router.delete("/batches/:id", requirePermission(Permission.MANAGE_BATCHES), deleteBatch);
router.get("/batches/:batchId/students", requirePermission(Permission.MANAGE_BATCHES), getBatchStudents);

// 6. Attendance Management
router.get("/attendance", requirePermission(Permission.MANAGE_ATTENDANCE), getAttendanceRecords);
router.post("/attendance", requirePermission(Permission.MANAGE_ATTENDANCE), saveAttendance);

// 7. Payments & Finance
router.get("/payments", requirePermission(Permission.VIEW_PAYMENTS), getPayments);
router.get("/finance", requirePermission(Permission.VIEW_PAYMENTS), getPayments);
router.post("/payments/:id/refund", requirePermission(Permission.VIEW_PAYMENTS), refundPayment);

// 8. Inquiries
router.get("/inquiries", requirePermission(Permission.MANAGE_COMMUNICATION), getInquiries);
router.patch("/inquiries/:id", requirePermission(Permission.MANAGE_COMMUNICATION), updateInquiryStatus);
router.delete("/inquiries/:id", requirePermission(Permission.MANAGE_COMMUNICATION), deleteInquiry);

// 9. Admin Self-Profile
router.get("/profile", getAdminProfile);
router.put("/profile", updateAdminProfile);
router.post("/profile/change-password", changeAdminPassword);

export default router;
