import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { signUserToken } from "../../lib/authHelpers";
import { assertContactVerified, OtpError, sendEnrollmentOtp, verifyEnrollmentOtp } from "../../lib/otp";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_CONSENT_VERSION = "2026-09-16";

function normalisePhone(value: unknown, countryCode: unknown = "+91"): string | null {
  const digits = String(value || "").replace(/\D/g, "");
  const countryDigits = String(countryCode || "+91").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  if (digits.length === 10) return `+${countryDigits || "91"}${digits}`;
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

type SignupChannel = "EMAIL" | "MOBILE";

function getSignupContact(input: unknown, countryCode?: unknown):
  | { channel: "EMAIL"; email: string }
  | { channel: "MOBILE"; phone: string; countryCode: string }
  | null {
  const value = String(input || "").trim();
  if (!value) return null;

  if (EMAIL_PATTERN.test(value)) {
    return { channel: "EMAIL", email: value.toLowerCase() };
  }

  const phone = normalisePhone(value, countryCode);
  if (!phone) return null;
  return {
    channel: "MOBILE",
    phone,
    countryCode: String(countryCode || "+91"),
  };
}

function loginDestination(hasActiveEnrollment: boolean) {
  return hasActiveEnrollment ? "DASHBOARD" : "COURSE_EXPLORE";
}

/** A new account must choose and pay for a course before entering the dashboard. */
function signupDestination() {
  return "COURSE_EXPLORE";
}

/**
 * Step 1 of mobile signup. The visitor may enter either an email address or a phone number.
 * Only this first contact is OTP-verified. The other contact is collected after verification.
 */
export const mobileSignupSendOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const contact = getSignupContact(req.body?.identifier, req.body?.countryCode);
    if (!contact) {
      res.status(400).json({ status: "error", message: "Enter a valid email address or phone number." });
      return;
    }

    const existing = await prisma.user.findFirst({
      where:
        contact.channel === "EMAIL"
          ? { email: contact.email }
          : { phone: { in: phoneCandidates(contact.phone) } },
      select: { id: true },
    });
    if (existing) {
      res.status(409).json({
        status: "error",
        code: "ACCOUNT_EXISTS",
        message: "An account already exists. Please log in with your existing email and password.",
      });
      return;
    }

    const result =
      contact.channel === "EMAIL"
        ? await sendEnrollmentOtp({ channel: "EMAIL", email: contact.email })
        : await sendEnrollmentOtp({
            channel: "MOBILE",
            phone: contact.phone,
            countryCode: contact.countryCode,
          });

    res.status(200).json({
      status: "success",
      message: "OTP sent. Verify it to continue creating your account.",
      data: {
        channel: result.channel,
        identifier: result.target,
        nextStep: "VERIFY_OTP",
      },
    });
  } catch (error) {
    const statusCode = error instanceof OtpError ? error.statusCode : 500;
    res.status(statusCode).json({
      status: "error",
      message: error instanceof Error ? error.message : "Unable to send OTP. Please try again.",
    });
  }
};

/** Step 2 of mobile signup. Returns no login token; account details are still required. */
export const mobileSignupVerifyOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const contact = getSignupContact(req.body?.identifier, req.body?.countryCode);
    const code = String(req.body?.code || "").trim();
    if (!contact || !code) {
      res.status(400).json({ status: "error", message: "Identifier and OTP are required." });
      return;
    }

    const verified =
      contact.channel === "EMAIL"
        ? await verifyEnrollmentOtp({ channel: "EMAIL", email: contact.email, code })
        : await verifyEnrollmentOtp({
            channel: "MOBILE",
            phone: contact.phone,
            countryCode: contact.countryCode,
            code,
          });

    res.status(200).json({
      status: "success",
      message: "OTP verified. Complete your profile to create the account.",
      data: {
        channel: verified.channel,
        identifier: verified.target,
        requiredFields:
          verified.channel === "EMAIL"
            ? ["fullName", "phone", "termsAccepted"]
            : ["fullName", "email", "termsAccepted"],
        secondContactVerification: "BYPASSED_ONCE_DURING_SIGNUP",
        nextStep: "COMPLETE_SIGNUP",
      },
    });
  } catch (error) {
    const statusCode = error instanceof OtpError ? error.statusCode : 500;
    res.status(statusCode).json({
      status: "error",
      message: error instanceof Error ? error.message : "Unable to verify OTP. Please try again.",
    });
  }
};

/**
 * Step 3 of mobile signup. The initially-entered contact must have a recent verified OTP.
 * The second contact is deliberately not OTP-verified in this first-release flow.
 * Passwords are not collected in the OTP-only mobile flow.
 */
export const mobileSignupComplete = async (req: Request, res: Response): Promise<void> => {
  try {
    const verifiedContact = getSignupContact(req.body?.verifiedIdentifier, req.body?.countryCode);
    const fullName = String(req.body?.fullName || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const phone = normalisePhone(req.body?.phone, req.body?.countryCode);
    const password = String(req.body?.password || "");
    const confirmPassword = String(req.body?.confirmPassword || "");
    const termsAccepted = req.body?.termsAccepted === true;

    if (!verifiedContact) {
      res.status(400).json({ status: "error", message: "Verified email address or phone number is required." });
      return;
    }
    if (fullName.length < 2 || fullName.length > 120) {
      res.status(400).json({ status: "error", message: "Please enter your full name." });
      return;
    }
    if (!EMAIL_PATTERN.test(email) || !phone) {
      res.status(400).json({ status: "error", message: "A valid email address and phone number are required." });
      return;
    }
    if (
      (verifiedContact.channel === "EMAIL" && verifiedContact.email !== email) ||
      (verifiedContact.channel === "MOBILE" && !phoneCandidates(phone).includes(verifiedContact.phone))
    ) {
      res.status(400).json({ status: "error", message: "The verified contact must match your signup details." });
      return;
    }
    if ((password || confirmPassword) && (password.length < 8 || password.length > 128)) {
      res.status(400).json({ status: "error", message: "Password must be between 8 and 128 characters." });
      return;
    }
    if ((password || confirmPassword) && password !== confirmPassword) {
      res.status(400).json({ status: "error", message: "Password and confirm password do not match." });
      return;
    }
    if (!termsAccepted) {
      res.status(400).json({ status: "error", message: "You must accept the Terms of Service and Privacy Policy." });
      return;
    }

    // The first contact was verified in step 2. The second contact is deliberately
    // collected without another OTP for this first mobile-app release.
    await assertContactVerified(
      verifiedContact.channel,
      verifiedContact.channel === "EMAIL" ? verifiedContact.email : verifiedContact.phone
    );

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone: { in: phoneCandidates(phone) } }] },
      select: { id: true },
    });
    if (existing) {
      res.status(409).json({ status: "error", message: "An account already exists with this email address or phone number." });
      return;
    }

    // The mobile app uses OTP authentication. A random hash satisfies the shared
    // user schema while ensuring no password is created or exposed to the client.
    const passwordForStorage = password || crypto.randomBytes(32).toString("base64url");
    const acceptedAt = new Date();
    const user = await prisma.user.create({
      data: {
        fullName,
        email,
        phone,
        passwordHash: await bcrypt.hash(passwordForStorage, 12),
        role: Role.STUDENT,
        termsAcceptedAt: acceptedAt,
        privacyPolicyAcceptedAt: acceptedAt,
        consentVersion: MOBILE_CONSENT_VERSION,
      },
      include: { enrollments: { where: { active: true }, select: { id: true }, take: 1 } },
    });

    const hasActiveEnrollment = user.enrollments.length > 0;
    res.status(201).json({
      status: "success",
      message: "Account created successfully.",
      data: {
        ...createMobileSession(user),
        user: mobileUser(user),
        enrollment: { hasActiveEnrollment },
        nextScreen: signupDestination(),
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      res.status(409).json({ status: "error", message: "An account already exists with this email address or phone number." });
      return;
    }
    const statusCode = error instanceof OtpError ? error.statusCode : 500;
    res.status(statusCode).json({
      status: "error",
      message: error instanceof Error ? error.message : "Unable to create your account. Please try again.",
    });
  }
};

/** Creates a mobile student account only. It never creates an enrollment, payment, or batch membership. */
export const mobileSignup = async (req: Request, res: Response): Promise<void> => {
  try {
    const fullName = String(req.body?.fullName || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const phone = normalisePhone(req.body?.phone, req.body?.countryCode);
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
        nextScreen: signupDestination(),
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
        nextScreen: loginDestination(user.enrollments.length > 0),
      },
    });
  } catch (error) {
    console.error("Mobile login error:", error);
    res.status(500).json({ status: "error", message: "Unable to log in. Please try again." });
  }
};
