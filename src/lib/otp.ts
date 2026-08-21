import crypto from "crypto";
import { prisma } from "./prisma";
import { env } from "../config/env";
import { sendEmail } from "./mailer";

export class OtpError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "OtpError";
    this.statusCode = statusCode;
  }
}

export const MOBILE_OTP_BYPASS = env.mobileOtpBypass || "001122";
export const EMAIL_OTP_BYPASS = env.mobileOtpBypass || "001122";
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_GAP_MS = 45 * 1000;
const VERIFY_WINDOW_MS = 2 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const hashOtp = (code: string) =>
  crypto.createHmac("sha256", env.jwtSecret).update(code).digest("hex");

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const toE164 = (phone: unknown, countryCode: unknown = "+91"): string => {
  const digits = String(phone || "").replace(/\D/g, "");
  const code = String(countryCode || "+91").replace(/\D/g, "");
  if (code && digits.startsWith(code)) return `+${digits}`;
  return `+${code}${digits}`;
};

const normalizeTarget = (channel: "EMAIL" | "MOBILE", raw: string, countryCode?: string) => {
  if (channel === "EMAIL") {
    const email = raw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new OtpError("Please enter a valid email address.");
    }
    return email;
  }
  return toE164(raw, countryCode || "+91");
};

export const sendEnrollmentOtp = async (params: {
  channel: "EMAIL" | "MOBILE";
  email?: string;
  phone?: string;
  countryCode?: string;
}) => {
  const channel = params.channel;
  const raw = channel === "EMAIL" ? params.email : params.phone;
  if (!raw?.trim()) {
    throw new OtpError(channel === "EMAIL" ? "Email is required." : "Mobile number is required.");
  }

  const target = normalizeTarget(channel, raw, params.countryCode);

  const latest = await prisma.verificationOtp.findFirst({
    where: { channel, target },
    orderBy: { createdAt: "desc" },
  });

  if (latest && Date.now() - latest.createdAt.getTime() < RESEND_GAP_MS) {
    throw new OtpError("Please wait a few seconds before requesting another OTP.", 429);
  }

  const code = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await prisma.verificationOtp.create({
    data: {
      channel,
      target,
      codeHash: hashOtp(code),
      expiresAt,
    },
  });

  if (channel === "EMAIL") {
    void sendEmail({
      to: target,
      subject: "Kathak Academy Email Verification OTP",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #333;">
          <h2 style="color:#900C27;">Verify your email</h2>
          <p>Use this OTP to continue student enrollment:</p>
          <p style="font-size:28px; font-weight:800; letter-spacing:6px; color:#900C27;">${code}</p>
          <p>This code expires in 10 minutes. If you did not request this, you can ignore the email.</p>
        </div>
      `,
    }).then((sent) => {
      if (!sent) {
        console.warn(`SMTP failed for ${target}. Email OTP bypass ${EMAIL_OTP_BYPASS} is active.`);
      }
    });

    return {
      channel,
      target,
      message: `Use OTP ${EMAIL_OTP_BYPASS} to verify your email if the message does not arrive.`,
      bypass: true,
      bypassCode: EMAIL_OTP_BYPASS,
    };
  }

  return {
    channel,
    target,
    message: `SMS is not enabled yet. Use OTP ${MOBILE_OTP_BYPASS} to verify your mobile number until Twilio is connected.`,
    bypass: true,
    bypassCode: MOBILE_OTP_BYPASS,
  };
};

export const verifyEnrollmentOtp = async (params: {
  channel: "EMAIL" | "MOBILE";
  email?: string;
  phone?: string;
  countryCode?: string;
  code: string;
}) => {
  const channel = params.channel;
  const raw = channel === "EMAIL" ? params.email : params.phone;
  const code = String(params.code || "").trim();
  if (!raw?.trim()) {
    throw new OtpError(channel === "EMAIL" ? "Email is required." : "Mobile number is required.");
  }
  if (!code) throw new OtpError("OTP is required.");

  const target = normalizeTarget(channel, raw, params.countryCode);
  const isBypass =
    (channel === "MOBILE" && code === MOBILE_OTP_BYPASS) ||
    (channel === "EMAIL" && code === EMAIL_OTP_BYPASS);

  const latest = await prisma.verificationOtp.findFirst({
    where: { channel, target },
    orderBy: { createdAt: "desc" },
  });

  if (!latest && !isBypass) {
    throw new OtpError("Please request an OTP first.");
  }

  if (latest && latest.attempts >= MAX_ATTEMPTS && !isBypass) {
    throw new OtpError("Too many incorrect attempts. Please request a new OTP.");
  }

  const valid =
    isBypass ||
    Boolean(latest && latest.expiresAt.getTime() >= Date.now() && latest.codeHash === hashOtp(code));

  if (!valid) {
    if (latest) {
      await prisma.verificationOtp.update({
        where: { id: latest.id },
        data: { attempts: { increment: 1 } },
      });
    }
    throw new OtpError("Invalid or expired OTP.");
  }

  if (latest) {
    await prisma.verificationOtp.update({
      where: { id: latest.id },
      data: { verifiedAt: new Date(), attempts: latest.attempts },
    });
  } else {
    await prisma.verificationOtp.create({
      data: {
        channel,
        target,
        codeHash: hashOtp(code),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        verifiedAt: new Date(),
      },
    });
  }

  return { channel, target, verified: true };
};

export const assertContactVerified = async (
  channel: "EMAIL" | "MOBILE",
  target: string
): Promise<void> => {
  const since = new Date(Date.now() - VERIFY_WINDOW_MS);
  const verified = await prisma.verificationOtp.findFirst({
    where: {
      channel,
      target,
      verifiedAt: { gte: since },
    },
    orderBy: { verifiedAt: "desc" },
  });

  if (!verified) {
    throw new OtpError(
      channel === "EMAIL"
        ? "Please verify your email with the OTP before payment."
        : "Please verify your mobile number with the OTP before payment."
    );
  }
};
