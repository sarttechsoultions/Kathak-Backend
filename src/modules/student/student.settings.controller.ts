import { Request, Response } from "express";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma";
import { sendEnrollmentOtp, verifyEnrollmentOtp, OtpError } from "../../lib/otp";

type StudentSettingsPrefs = {
  liveClassReminders: boolean;
  assignmentDeadlines: boolean;
  academyAnnouncements: boolean;
  language: string;
  theme: "light" | "dark";
};

const DEFAULT_PREFS: StudentSettingsPrefs = {
  liveClassReminders: true,
  assignmentDeadlines: true,
  academyAnnouncements: false,
  language: "English (US)",
  theme: "light",
};

function parseStudentSettingsPrefs(raw: unknown): StudentSettingsPrefs {
  if (!raw) return DEFAULT_PREFS;

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return DEFAULT_PREFS;
    }
  }

  if (typeof parsed === "object" && parsed !== null) {
    const prefs = parsed as Record<string, unknown>;
    return {
      liveClassReminders: prefs.liveClassReminders !== false,
      assignmentDeadlines: prefs.assignmentDeadlines !== false,
      academyAnnouncements: prefs.academyAnnouncements === true,
      language:
        typeof prefs.language === "string" && prefs.language.trim()
          ? prefs.language
          : DEFAULT_PREFS.language,
      theme: prefs.theme === "dark" ? "dark" : "light",
    };
  }

  return DEFAULT_PREFS;
}

const normalizeForLookup = (input: unknown): string[] => {
  const cleaned = String(input || "").replace(/[^\d+]/g, "").trim();
  const digitsOnly = cleaned.replace(/\D/g, "");
  const candidates = new Set<string>();

  if (cleaned.startsWith("+")) candidates.add(cleaned);
  candidates.add(`+${digitsOnly}`);
  candidates.add(digitsOnly);
  if (digitsOnly.length === 10) candidates.add(`+91${digitsOnly}`);
  if (digitsOnly.length === 12 && digitsOnly.startsWith("91")) candidates.add(`+${digitsOnly}`);

  return Array.from(candidates);
};

async function findActiveStudentByEmailOrPhone(emailOrPhone: string) {
  const loginValue = String(emailOrPhone || "").trim();
  if (!loginValue) return null;

  if (loginValue.includes("@")) {
    return prisma.user.findFirst({
      where: {
        email: loginValue.toLowerCase(),
        role: Role.STUDENT,
        isActive: true,
      },
    });
  }

  return prisma.user.findFirst({
    where: {
      phone: { in: normalizeForLookup(loginValue) },
      role: Role.STUDENT,
      isActive: true,
    },
  });
}

export const getStudentSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    const student = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        avatarUrl: true,
        skillLevel: true,
        notificationPrefs: true,
        batchMemberships: {
          select: {
            batch: { select: { name: true, courseName: true, code: true } },
          },
          take: 1,
        },
      },
    });

    if (!student) {
      res.status(404).json({ status: "error", message: "Student not found" });
      return;
    }

    const batch = student.batchMemberships[0]?.batch;
    const prefs = parseStudentSettingsPrefs(student.notificationPrefs);

    res.json({
      status: "success",
      data: {
        id: student.id,
        fullName: student.fullName,
        email: student.email,
        phone: student.phone?.replace(/^\+91/, "") || "",
        avatarUrl: student.avatarUrl,
        level: student.skillLevel,
        batch: batch?.name || batch?.courseName || batch?.code || null,
        notificationPrefs: prefs,
      },
    });
  } catch (error) {
    console.error("Get student settings error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch settings." });
  }
};

export const updateStudentSettingsProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    const { fullName, phone } = req.body;
    const student = await prisma.user.findUnique({ where: { id: userId } });
    if (!student) {
      res.status(404).json({ status: "error", message: "Student not found" });
      return;
    }

    const digits = String(phone || "").replace(/\D/g, "");
    const normalizedPhone = digits ? `+91${digits.slice(-10)}` : student.phone;

    if (digits && normalizedPhone !== student.phone) {
      const existingPhone = await prisma.user.findFirst({
        where: { phone: normalizedPhone, NOT: { id: student.id } },
      });
      if (existingPhone) {
        res.status(409).json({ status: "error", message: "Phone number already exists." });
        return;
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(fullName !== undefined && { fullName: String(fullName).trim() }),
        ...(phone !== undefined && digits && { phone: normalizedPhone }),
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        avatarUrl: true,
        skillLevel: true,
      },
    });

    res.json({
      status: "success",
      message: "Account settings saved.",
      data: {
        ...updated,
        phone: updated.phone?.replace(/^\+91/, "") || "",
      },
    });
  } catch (error) {
    console.error("Update student settings profile error:", error);
    res.status(500).json({ status: "error", message: "Failed to update account settings." });
  }
};

export const updateStudentSettingsNotifications = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    const student = await prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPrefs: true },
    });

    if (!student) {
      res.status(404).json({ status: "error", message: "Student not found" });
      return;
    }

    const current = parseStudentSettingsPrefs(student.notificationPrefs);
    const body = req.body || {};

    const next = {
      liveClassReminders:
        body.liveClassReminders !== undefined ? Boolean(body.liveClassReminders) : current.liveClassReminders,
      assignmentDeadlines:
        body.assignmentDeadlines !== undefined
          ? Boolean(body.assignmentDeadlines)
          : current.assignmentDeadlines,
      academyAnnouncements:
        body.academyAnnouncements !== undefined
          ? Boolean(body.academyAnnouncements)
          : current.academyAnnouncements,
      language:
        typeof body.language === "string" && body.language.trim() ? body.language : current.language,
      theme: body.theme === "dark" ? "dark" : body.theme === "light" ? "light" : current.theme,
    } satisfies StudentSettingsPrefs;

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { notificationPrefs: next },
      select: { notificationPrefs: true },
    });

    res.json({
      status: "success",
      message: "Preferences saved.",
      data: { notificationPrefs: parseStudentSettingsPrefs(updated.notificationPrefs) },
    });
  } catch (error) {
    console.error("Update student settings notifications error:", error);
    res.status(500).json({ status: "error", message: "Failed to save preferences." });
  }
};

export const sendStudentForgotPasswordOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const emailOrPhone = String(req.body.emailOrPhone || "").trim();
    if (!emailOrPhone) {
      res.status(400).json({ status: "error", message: "Email or mobile number is required." });
      return;
    }

    const student = await findActiveStudentByEmailOrPhone(emailOrPhone);
    if (!student) {
      res.status(404).json({
        status: "error",
        message: "No active student account found for this email or mobile number.",
      });
      return;
    }

    const channel = emailOrPhone.includes("@") ? "EMAIL" : "MOBILE";
    const data = await sendEnrollmentOtp({
      channel,
      email: channel === "EMAIL" ? student.email : undefined,
      phone: channel === "MOBILE" ? student.phone : undefined,
      countryCode: student.countryCode || "+91",
    });

    res.json({
      status: "success",
      message: data.message,
      data: {
        channel,
        maskedTarget:
          channel === "EMAIL"
            ? student.email.replace(/(.{2}).+(@.+)/, "$1***$2")
            : student.phone?.replace(/\d(?=\d{4})/g, "*") || "",
        bypassCode: data.bypassCode,
      },
    });
  } catch (error: unknown) {
    if (error instanceof OtpError) {
      res.status(error.statusCode).json({ status: "error", message: error.message });
      return;
    }
    console.error("Send forgot password OTP error:", error);
    res.status(500).json({ status: "error", message: "Failed to send OTP." });
  }
};

export const resetStudentForgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const emailOrPhone = String(req.body.emailOrPhone || "").trim();
    const code = String(req.body.code || "").trim();
    const newPassword = String(req.body.newPassword || "");

    if (!emailOrPhone || !code || !newPassword) {
      res.status(400).json({
        status: "error",
        message: "Email/mobile, OTP, and new password are required.",
      });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ status: "error", message: "New password must be at least 6 characters." });
      return;
    }

    const student = await findActiveStudentByEmailOrPhone(emailOrPhone);
    if (!student) {
      res.status(404).json({ status: "error", message: "Student account not found." });
      return;
    }

    const channel = emailOrPhone.includes("@") ? "EMAIL" : "MOBILE";
    await verifyEnrollmentOtp({
      channel,
      email: channel === "EMAIL" ? student.email : undefined,
      phone: channel === "MOBILE" ? student.phone : undefined,
      countryCode: student.countryCode || "+91",
      code,
    });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: student.id },
      data: { passwordHash },
    });

    res.json({
      status: "success",
      message: "Password reset successfully. You can now sign in with your new password.",
    });
  } catch (error: unknown) {
    if (error instanceof OtpError) {
      res.status(error.statusCode).json({ status: "error", message: error.message });
      return;
    }
    console.error("Reset forgot password error:", error);
    res.status(500).json({ status: "error", message: "Failed to reset password." });
  }
};
