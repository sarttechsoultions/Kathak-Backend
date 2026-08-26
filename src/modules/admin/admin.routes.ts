import { Router } from "express";
import { Permission } from "@prisma/client";
import eventRoutes from './event.routes';
import { adminGalleryRouter } from "../gallery/gallery.routes";
import { adminStudentCornerRouter } from "../student-corner/student-corner.routes";
import { adminBannersRouter } from "../banners/banners.routes";
import { adminPopupRouter } from "../popup/popup.routes";
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
  getCourseById,
  createCourse,
  updateCourse,
  deleteCourse,
  addLesson,
  deleteLesson,
  getBatches,
  getBatchById,
  createBatch,
  updateBatch,
  deleteBatch,
  getAssignments,
  createAssignment,
  getAssignmentSubmissions,
  gradeAssignmentSubmission,
  getAssignmentDetails,
  getAssignmentSubmissionsByAssignment,
  getAttendanceRecords,
  saveAttendance,
  getPayments,
  recordFeePayment,
  refundPayment,
  getPaymentInvoice,
  exportFinanceCsv,
  getInquiries,
  updateInquiryStatus,
  deleteInquiry,
  getAdminProfile,
  updateAdminProfile,
  changeAdminPassword,
  updateStudentPassword,
  replyToInquiry
} from "./admin.controller";
import { getReportsOverview } from "./admin.reports.controller";
import { forwardToDeveloper } from "../support/support.controller";
import { authenticate, requireAnyPermission, requirePermission } from "../../middleware/auth.middleware";

const router = Router();



router.use('/events', eventRoutes);
router.use('/gallery', adminGalleryRouter);
router.use('/student-corner', adminStudentCornerRouter);
router.use('/banners', adminBannersRouter);
router.use('/popup', adminPopupRouter);
router.use(authenticate);

// 1. Dashboard Overview
router.get("/dashboard", requirePermission(Permission.VIEW_DASHBOARD), getDashboardStats);

// 2. Student Management
router.get("/students", requirePermission(Permission.MANAGE_STUDENTS), getStudents);
router.post("/students", requirePermission(Permission.MANAGE_STUDENTS), createStudent);
router.get("/students/:id", requirePermission(Permission.MANAGE_STUDENTS), getStudentById);
router.put("/students/:id", requirePermission(Permission.MANAGE_STUDENTS), updateStudent);
router.post("/students/:id/reset-password", requirePermission(Permission.MANAGE_STUDENTS), updateStudentPassword);
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
router.get("/courses/:id", requirePermission(Permission.MANAGE_COURSES), getCourseById);
router.post("/courses", requirePermission(Permission.MANAGE_COURSES), createCourse);
router.put("/courses/:id", requirePermission(Permission.MANAGE_COURSES), updateCourse);
router.delete("/courses/:id", requirePermission(Permission.MANAGE_COURSES), deleteCourse);
router.post("/courses/:id/lessons", requirePermission(Permission.MANAGE_COURSES), addLesson);
router.delete("/courses/:id/lessons/:lessonId", requirePermission(Permission.MANAGE_COURSES), deleteLesson);

// 5. Batch Management
router.get("/batches", requirePermission(Permission.MANAGE_BATCHES), getBatches);
router.get("/batches/:id", requirePermission(Permission.MANAGE_BATCHES), getBatchById); 
router.post("/batches", requirePermission(Permission.MANAGE_BATCHES), createBatch);
router.put("/batches/:id", requirePermission(Permission.MANAGE_BATCHES), updateBatch);
router.delete("/batches/:id", requirePermission(Permission.MANAGE_BATCHES), deleteBatch);
router.get("/batches/:batchId/students", requirePermission(Permission.MANAGE_BATCHES), getBatchStudents);

// 5.5 Assignment Management
router.get("/assignments", requirePermission(Permission.MANAGE_COURSES), getAssignments);
router.post("/assignments", requirePermission(Permission.MANAGE_COURSES), createAssignment);
router.get("/assignments/submissions", requirePermission(Permission.MANAGE_COURSES), getAssignmentSubmissions);
router.post("/assignments/submissions/:id/grade", requirePermission(Permission.MANAGE_COURSES), gradeAssignmentSubmission);
router.get("/assignments/:id", requirePermission(Permission.MANAGE_COURSES), getAssignmentDetails);
router.get(
  "/assignments/:id/submissions",
  requirePermission(Permission.MANAGE_COURSES),
  getAssignmentSubmissionsByAssignment
);



// 6. Attendance Management
router.get("/attendance", requirePermission(Permission.MANAGE_ATTENDANCE), getAttendanceRecords);
router.post("/attendance", requirePermission(Permission.MANAGE_ATTENDANCE), saveAttendance);

// 7. Payments & Finance
router.get("/payments", requirePermission(Permission.VIEW_PAYMENTS), getPayments);
router.get("/finance", requirePermission(Permission.VIEW_PAYMENTS), getPayments);
router.get("/finance/export.csv", requirePermission(Permission.VIEW_PAYMENTS), exportFinanceCsv);
router.get("/payments/:id/invoice", requirePermission(Permission.VIEW_PAYMENTS), getPaymentInvoice);
router.post("/payments", requirePermission(Permission.VIEW_PAYMENTS), recordFeePayment);
router.post("/payments/:id/refund", requirePermission(Permission.VIEW_PAYMENTS), refundPayment);

// 8. Inquiries
router.get("/inquiries", requireAnyPermission(Permission.MANAGE_COMMUNICATION, Permission.MANAGE_WEBSITE), getInquiries);
router.patch("/inquiries/:id", requireAnyPermission(Permission.MANAGE_COMMUNICATION, Permission.MANAGE_WEBSITE), updateInquiryStatus);
router.post("/inquiries/:id/reply", requireAnyPermission(Permission.MANAGE_COMMUNICATION, Permission.MANAGE_WEBSITE), replyToInquiry);
router.post("/inquiries/:id/forward-dev", requirePermission(Permission.MANAGE_COMMUNICATION), forwardToDeveloper);
router.delete("/inquiries/:id", requireAnyPermission(Permission.MANAGE_COMMUNICATION, Permission.MANAGE_WEBSITE), deleteInquiry);


// 9. Admin Self-Profile
router.get("/profile", getAdminProfile);
router.put("/profile", updateAdminProfile);
router.post("/profile/change-password", changeAdminPassword);

// 10. Reports & Analytics
router.get("/reports/overview", getReportsOverview);

export default router;
