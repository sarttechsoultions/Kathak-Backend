import { Router } from "express";
import { getNotifications, markAsRead, markAllAsRead, getUnreadCount, saveFcmToken } from "./notification.controller";
import { authenticate } from "../../middleware/auth.middleware";

const router = Router();

router.get("/", authenticate, getNotifications);
router.post("/fcm-token", authenticate, saveFcmToken);
router.get("/unread-count", authenticate, getUnreadCount);
router.put("/read-all", authenticate, markAllAsRead);
router.put("/:id/read", authenticate, markAsRead);

export { router as notificationRoutes };
