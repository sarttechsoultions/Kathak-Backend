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

router.use(authenticate);

// Admin Routes
router.get("/admin/recorded-classes", requirePermission("MANAGE_RECORDED_CLASSES" as any), getAdminRecordedClasses);
router.post("/admin/recorded-classes", requirePermission("MANAGE_RECORDED_CLASSES" as any), createRecordedClass);
router.delete("/admin/recorded-classes/:id", requirePermission("MANAGE_RECORDED_CLASSES" as any), deleteRecordedClass);
router.post("/student/recorded-classes/:id/view", authenticate, recordClassView);

// Student Route
router.get("/student/recorded-classes", getStudentRecordedClasses);
router.get("/student/recorded-classes/:id", getStudentSingleRecordedClass);

export default router;