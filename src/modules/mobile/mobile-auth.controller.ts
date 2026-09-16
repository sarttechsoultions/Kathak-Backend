import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { signUserToken } from "../../lib/authHelpers";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_CONSENT_VERSION = "2026-09-16";

function normalisePhone(value: unknown): string | null {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
}

function phoneCandidates(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  return [...new Set([phone, digits, `+${digits}`, digits.length === 10 ? `+91${digits}` : ""])].filter(Boolean);
}

function mobileUser(user: { id: string; fullName: string; email: string; phone: string; avatarUrl: string | null }) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: Role.STUDENT,
    avatarUrl: user.avatarUrl,
  };
}

function createMobileSession(user: { id: string; email: string; role: Role }) {
  const { token, expiresInMs } = signUserToken({
    id: user.id,
    email: user.email,
    role: user.role,
    permissions: [],
  });
  return {
    accessToken: token,
    tokenType: "Bearer",
    expiresIn: Math.floor(expiresInMs / 1000),
  };
}

/** Creates a mobile student account only. It never creates an enrollment, payment, or batch membership. */
export const mobileSignup = async (req: Request, res: Response): Promise<void> => {
  try {
    const fullName = String(req.body?.fullName || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const phone = normalisePhone(req.body?.phone);
    const password = String(req.body?.password || "");
    const confirmPassword = String(req.body?.confirmPassword || "");
    const termsAccepted = req.body?.termsAccepted === true;

    if (fullName.length < 2 || fullName.length > 120) {
      res.status(400).json({ status: "error", message: "Please enter your full name." });
      return;
    }
    if (!EMAIL_PATTERN.test(email)) {
      res.status(400).json({ status: "error", message: "Please enter a valid email address." });
      return;
    }
    if (!phone) {
      res.status(400).json({ status: "error", message: "Please enter a valid phone number." });
      return;
    }
    if (password.length < 8 || password.length > 128) {
      res.status(400).json({ status: "error", message: "Password must be between 8 and 128 characters." });
      return;
    }
    if (password !== confirmPassword) {
      res.status(400).json({ status: "error", message: "Password and confirm password do not match." });
      return;
    }
    if (!termsAccepted) {
      res.status(400).json({ status: "error", message: "You must accept the Terms of Service and Privacy Policy." });
      return;
    }

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone: { in: phoneCandidates(phone) } }] },
      select: { id: true },
    });
    if (existing) {
      res.status(409).json({ status: "error", message: "An account already exists with this email address or phone number." });
      return;
    }

    const acceptedAt = new Date();
    const user = await prisma.user.create({
      data: {
        fullName,
        email,
        phone,
        passwordHash: await bcrypt.hash(password, 12),
        role: Role.STUDENT,
        termsAcceptedAt: acceptedAt,
        privacyPolicyAcceptedAt: acceptedAt,
        consentVersion: MOBILE_CONSENT_VERSION,
      },
      select: { id: true, fullName: true, email: true, phone: true, avatarUrl: true, role: true },
    });

    res.status(201).json({
      status: "success",
      message: "Account created successfully. You can now choose a course to enroll in.",
      data: {
        ...createMobileSession(user),
        user: mobileUser(user),
        enrollment: { hasActiveEnrollment: false },
      },
    });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === "P2002") {
      res.status(409).json({ status: "error", message: "An account already exists with this email address or phone number." });
      return;
    }
    console.error("Mobile signup error:", error);
    res.status(500).json({ status: "error", message: "Unable to create your account. Please try again." });
  }
};

/** Email/password login for the mobile app. Enrollment remains a separate later step. */
export const mobileLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!EMAIL_PATTERN.test(email) || !password) {
      res.status(400).json({ status: "error", message: "Email and password are required." });
      return;
    }

    const user = await prisma.user.findFirst({
      where: { email, role: Role.STUDENT },
      include: { enrollments: { where: { active: true }, select: { id: true }, take: 1 } },
    });
    if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json({ status: "error", message: "Invalid email or password." });
      return;
    }

    res.status(200).json({
      status: "success",
      message: "Login successful.",
      data: {
        ...createMobileSession(user),
        user: mobileUser(user),
        enrollment: { hasActiveEnrollment: user.enrollments.length > 0 },
      },
    });
  } catch (error) {
    console.error("Mobile login error:", error);
    res.status(500).json({ status: "error", message: "Unable to log in. Please try again." });
  }
};
