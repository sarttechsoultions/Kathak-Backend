import rateLimit from "express-rate-limit";
import { env } from "../config/env";

export const generalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.isProduction ? 300 : 100000,
  skip: () => !env.isProduction,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    message: "Too many requests. Please try again later.",
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.isProduction ? 15 : 10000,
  skip: () => !env.isProduction,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    status: "error",
    message: "Too many login attempts. Please try again in 15 minutes.",
  },
});

// Tighter limit for unauthenticated uploads (e.g. enroll profile photo).
// No login is required to hit this route, so it needs its own low ceiling
// independent of the general API limit to prevent storage-filling abuse.
export const publicUploadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.isProduction ? 10 : 10000,
  skip: () => !env.isProduction,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    message: "Too many upload attempts. Please try again in 15 minutes.",
  },
});
