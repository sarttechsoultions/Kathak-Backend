import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { 
  getTeacherSettings, 
  updateTeacherProfile, 
  updateTeacherSecurity, 
  updateNotificationPrefs 
} from "./teacher.settings.controller";

const router = Router();

// Secure all teacher routes
router.use(authenticate);

// Settings Routes
router.get("/settings", getTeacherSettings);
router.put("/settings/profile", updateTeacherProfile);
router.put("/settings/security", updateTeacherSecurity);
router.put("/settings/notifications", updateNotificationPrefs);

export default router;
