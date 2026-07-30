import { Router } from "express";
import { loginUser, logoutUser } from "./auth.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authRateLimiter } from "../../middleware/rateLimit.middleware";

const router = Router();

router.post("/login", authRateLimiter, loginUser);
router.post("/logout", authenticate, logoutUser);

export default router;
