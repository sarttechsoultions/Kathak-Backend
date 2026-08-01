import { Router } from "express";
import { loginUser, logoutUser, getMe, changePassword } from "./auth.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { authRateLimiter } from "../../middleware/rateLimit.middleware";

const router = Router();

router.post("/login", authRateLimiter, loginUser);
router.post("/logout", authenticate, logoutUser);
router.get("/me", authenticate, getMe);
router.post("/change-password", authenticate, changePassword);

export default router;
