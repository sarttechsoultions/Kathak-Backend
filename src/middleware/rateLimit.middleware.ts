import rateLimit from "express-rate-limit";
import { env } from "../config/env";

export const generalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.isProduction ? 200 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    message: "Too many requests. Please try again later.",
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.isProduction ? 10 : 50,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    status: "error",
    message: "Too many login attempts. Please try again in 15 minutes.",
  },
});
