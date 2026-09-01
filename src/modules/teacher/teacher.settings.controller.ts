import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import bcrypt from "bcryptjs";

type NotificationPrefs = {
  emailNotifs: boolean;
  pushNotifs: boolean;
  smsNotifs: boolean;
};

const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  emailNotifs: true,
  pushNotifs: true,
  smsNotifs: false,
};

function parseNotificationPrefs(raw: unknown): NotificationPrefs {
  if (!raw) return DEFAULT_NOTIFICATION_PREFS;

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return DEFAULT_NOTIFICATION_PREFS;
    }
  }

  if (typeof parsed === "object" && parsed !== null) {
    const prefs = parsed as Record<string, unknown>;
    return {
      emailNotifs: prefs.emailNotifs !== false,
      pushNotifs: prefs.pushNotifs !== false,
      smsNotifs: prefs.smsNotifs === true,
    };
  }

  return DEFAULT_NOTIFICATION_PREFS;
}

// GET /api/v1/teacher/settings
export const getTeacherSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    const teacher = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        avatarUrl: true,
        designation: true,
        primaryExpertise: true,
        notificationPrefs: true,
      },
    });

    if (!teacher) {
      res.status(404).json({ status: "error", message: "Teacher not found" });
      return;
    }

    res.status(200).json({
      status: "success",
      data: {
        ...teacher,
        notificationPrefs: parseNotificationPrefs(teacher.notificationPrefs),
      },
    });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message || "Failed to fetch settings" });
  }
};

// PUT /api/v1/teacher/settings/profile
export const updateTeacherProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    const { fullName, phone, designation, primaryExpertise, avatarUrl } = req.body;

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(fullName !== undefined && { fullName: String(fullName).trim() }),
        ...(phone !== undefined && { phone: String(phone).trim() }),
        ...(designation !== undefined && { designation: String(designation).trim() }),
        ...(primaryExpertise !== undefined && {
          primaryExpertise: String(primaryExpertise).trim(),
        }),
        ...(avatarUrl !== undefined && {
          avatarUrl: String(avatarUrl).trim() || null,
        }),
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        avatarUrl: true,
        designation: true,
        primaryExpertise: true,
      },
    });

    res.status(200).json({ status: "success", data: updated, message: "Profile updated successfully" });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message || "Failed to update profile" });
  }
};

// PUT /api/v1/teacher/settings/security
export const updateTeacherSecurity = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      res.status(400).json({ status: "error", message: "Current and new passwords are required" });
      return;
    }

    if (String(newPassword).length < 6) {
      res.status(400).json({ status: "error", message: "New password must be at least 6 characters" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ status: "error", message: "User not found" });
      return;
    }

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
      res.status(400).json({ status: "error", message: "Incorrect current password" });
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    res.status(200).json({ status: "success", message: "Password updated successfully" });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message || "Failed to update password" });
  }
};

// PUT /api/v1/teacher/settings/notifications
export const updateNotificationPrefs = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    const prefs = parseNotificationPrefs(req.body);

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        notificationPrefs: prefs,
      },
      select: {
        notificationPrefs: true,
      },
    });

    res.status(200).json({
      status: "success",
      data: { notificationPrefs: parseNotificationPrefs(updated.notificationPrefs) },
      message: "Notification preferences updated",
    });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message || "Failed to update notification preferences" });
  }
};
