import { Router } from "express";
import { authRateLimiter } from "../../middleware/rateLimit.middleware";
import {
  mobileLogin,
  mobileSignup,
  mobileSignupComplete,
  mobileSignupSendOtp,
  mobileSignupVerifyOtp,
} from "./mobile-auth.controller";

const router = Router();

router.post("/signup", authRateLimiter, mobileSignup);
router.post("/signup/send-otp", authRateLimiter, mobileSignupSendOtp);
router.post("/signup/verify-otp", authRateLimiter, mobileSignupVerifyOtp);
router.post("/signup/complete", authRateLimiter, mobileSignupComplete);
router.post("/login", authRateLimiter, mobileLogin);

export default router;
