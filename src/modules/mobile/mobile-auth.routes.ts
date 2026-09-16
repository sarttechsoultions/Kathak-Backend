import { Router } from "express";
import { authRateLimiter } from "../../middleware/rateLimit.middleware";
import { mobileLogin, mobileSignup } from "./mobile-auth.controller";

const router = Router();

router.post("/signup", authRateLimiter, mobileSignup);
router.post("/login", authRateLimiter, mobileLogin);

export default router;
