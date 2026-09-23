import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { getIO } from "../../lib/socket";
import { sendPushNotification } from "../../lib/firebase";

export const getNotifications = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    res.json({ status: "success", data: notifications });
  } catch (error: any) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch notifications." });
  }
};

export const markAsRead = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    await prisma.notification.updateMany({
      where: { id: id as string, userId },
      data: { isUnread: false },
    });

    res.json({ status: "success", message: "Marked as read." });
  } catch (error: any) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({ status: "error", message: "Failed to mark as read." });
  }
};

export const markAllAsRead = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    await prisma.notification.updateMany({
      where: { userId, isUnread: true },
      data: { isUnread: false },
    });

    res.json({ status: "success", message: "All notifications marked as read." });
  } catch (error: any) {
    console.error("Error marking all notifications as read:", error);
    res.status(500).json({ status: "error", message: "Failed to mark all as read." });
  }
};

export const getUnreadCount = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const count = await prisma.notification.count({
      where: { userId, isUnread: true },
    });

    res.json({ status: "success", count });
  } catch (error: any) {
    console.error("Error fetching unread notification count:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch unread count." });
  }
};

export const createNotification = async (
  userId: string,
  type: string,
  title: string,
  message: string,
  link?: string
) => {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
        link,
      },
    });

    // Emit real-time update via Socket.IO
    try {
      getIO().to(`user:${userId}`).emit("new-notification", notification);
    } catch (socketError) {
      console.error("Failed to emit notification via socket:", socketError);
    }

    // Send Firebase Push Notification
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { fcmTokens: true },
      });

      if (user && user.fcmTokens && user.fcmTokens.length > 0) {
        const invalidTokens = await sendPushNotification(
          user.fcmTokens,
          title,
          message,
          { link: link || "", type } // Optional payload
        );

        // Cleanup invalid or expired FCM tokens
        if (invalidTokens.length > 0) {
          await prisma.user.update({
            where: { id: userId },
            data: {
              fcmTokens: {
                set: user.fcmTokens.filter(t => !invalidTokens.includes(t))
              }
            }
          });
          console.log(`[Firebase] Removed ${invalidTokens.length} invalid tokens for user ${userId}`);
        }
      }
    } catch (fcmError) {
      console.error("Failed to send FCM push notification:", fcmError);
    }
  } catch (error) {
    console.error("Error creating notification internally:", error);
  }
};

/**
 * Use this instead of Prisma createMany for user-facing notifications.
 * createMany persists rows but bypasses socket and FCM delivery, which means
 * users only see the notification after a manual refresh.
 */
export const createNotifications = async (
  notifications: Array<{
    userId: string;
    type: string;
    title: string;
    message: string;
    link?: string | null;
  }>
) => {
  await Promise.all(
    notifications.map((notification) =>
      createNotification(
        notification.userId,
        notification.type,
        notification.title,
        notification.message,
        notification.link ?? undefined
      )
    )
  );
};

export const notifyAdmins = async (
  type: string,
  title: string,
  message: string,
  link?: string
) => {
  try {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN" },
      select: { id: true },
    });
    
    await Promise.all(
      admins.map((admin) =>
        createNotification(admin.id, type, title, message, link)
      )
    );
  } catch (error) {
    console.error("Error notifying admins:", error);
  }
};

export const saveFcmToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { token } = req.body;

    if (!token || typeof token !== "string") {
      res.status(400).json({ status: "error", message: "FCM token is required." });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fcmTokens: true },
    });

    if (!user) {
      res.status(404).json({ status: "error", message: "User not found." });
      return;
    }

    // Only add the token if it doesn't already exist
    const currentTokens = user.fcmTokens || [];
    if (!currentTokens.includes(token)) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          fcmTokens: { push: token }
        }
      });
    }

    res.json({ status: "success", message: "FCM token saved successfully." });
  } catch (error) {
    console.error("Error saving FCM token:", error);
    res.status(500).json({ status: "error", message: "Failed to save FCM token." });
  }
};
