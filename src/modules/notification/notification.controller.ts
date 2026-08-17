import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

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

export const createNotification = async (
  userId: string,
  type: string,
  title: string,
  message: string,
  link?: string
) => {
  try {
    await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
        link,
      },
    });
  } catch (error) {
    console.error("Error creating notification internally:", error);
  }
};
