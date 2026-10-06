import { Router } from "express";
import { getNotifications, markAsRead, markAllAsRead, getUnreadCount, saveFcmToken } from "./notification.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireActiveStudentAccess } from "../../middleware/access.middleware";

const router = Router();

router.get("/", authenticate, requireActiveStudentAccess, getNotifications);
router.post("/fcm-token", authenticate, requireActiveStudentAccess, saveFcmToken);
router.get("/unread-count", authenticate, requireActiveStudentAccess, getUnreadCount);
router.put("/read-all", authenticate, requireActiveStudentAccess, markAllAsRead);
router.put("/:id/read", authenticate, requireActiveStudentAccess, markAsRead);

export { router as notificationRoutes };
