import { Router } from "express";
import { authenticate, requirePermission } from "../../middleware/auth.middleware";
import { 
  getAdminRecordedClasses, 
  createRecordedClass, 
  deleteRecordedClass, 
  getStudentRecordedClasses,
    getStudentSingleRecordedClass,
    recordClassView
} from "./recordedClass.controller";

const router = Router();

// Admin Routes
router.get("/admin/recorded-classes", authenticate, requirePermission("MANAGE_RECORDED_CLASSES" as any), getAdminRecordedClasses);
router.post("/admin/recorded-classes", authenticate, requirePermission("MANAGE_RECORDED_CLASSES" as any), createRecordedClass);
router.delete("/admin/recorded-classes/:id", authenticate, requirePermission("MANAGE_RECORDED_CLASSES" as any), deleteRecordedClass);
router.post("/student/recorded-classes/:id/view", authenticate, recordClassView);

// Student Route
router.get("/student/recorded-classes", authenticate, getStudentRecordedClasses);
router.get("/student/recorded-classes/:id", authenticate, getStudentSingleRecordedClass);

export default router;