import dotenv from "dotenv";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function getJwtSecret(): string {
  const secret = requireEnv("JWT_SECRET");

  if (secret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters long.");
  }

  if (isProduction && (secret.includes("change_me") || secret.includes("kathak_secret"))) {
    throw new Error("JWT_SECRET must be a strong, unique value in production.");
  }

  return secret;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  adminSecret: process.env.ADMIN_SECRET || "default_admin_secret",
  smtp: {
    host: (process.env.SMTP_HOST || "smtp.gmail.com").trim(),
    port: parseInt(process.env.SMTP_PORT || "465", 10),
    user: process.env.SMTP_USER?.trim(),
    pass: process.env.SMTP_PASS?.replace(/\s/g, ""),
    from: process.env.SMTP_FROM?.trim().replace(/^["']|["']$/g, ""),
  },
  isProduction,
  port: Number(process.env.PORT) || 5000,
  databaseUrl: requireEnv("DATABASE_URL"),
  jwtSecret: getJwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
  jitsiAppId: process.env.JITSI_APP_ID?.trim(),
  jitsiDomain: process.env.JITSI_DOMAIN?.trim() || "8x8.vc",
  jitsiKeyId: process.env.JITSI_KEY_ID?.trim(),
  jitsiPrivateKey: process.env.JITSI_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  agoraAppId: process.env.AGORA_APP_ID,
  agoraAppCertificate: process.env.AGORA_APP_CERTIFICATE,

  // Bunny Stream — required, no hardcoded fallback (previously leaked in source)
  bunnyLibraryId: requireEnv("BUNNY_LIBRARY_ID"),
  bunnyApiKey: requireEnv("BUNNY_STREAM_API_KEY"),
  bunnyPullZoneHostname: requireEnv("BUNNY_PULL_ZONE_HOSTNAME"),

  // Cloudinary — required, no hardcoded fallback (previously leaked in source)
  cloudinaryCloudName: requireEnv("CLOUDINARY_CLOUD_NAME"),
  cloudinaryApiKey: requireEnv("CLOUDINARY_API_KEY"),
  cloudinaryApiSecret: requireEnv("CLOUDINARY_API_SECRET"),

  // Razorpay
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || "",
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || "",
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
  enablePaymentBypass: !isProduction || process.env.ENABLE_PAYMENT_BYPASS === "true",

  /** Dev/test OTP bypass code for email and mobile verification */
  mobileOtpBypass: process.env.MOBILE_OTP_BYPASS?.trim() || "001122",


  redisUrl: process.env.REDIS_URL?.trim(),


  publicUrl: isProduction
    ? requireEnv("PUBLIC_BACKEND_URL")
    : (process.env.PUBLIC_BACKEND_URL?.trim() || `http://localhost:${Number(process.env.PORT) || 5000}`),
} as const;