import { Router } from "express";
import { publicChatRateLimiter } from "../../middleware/rateLimit.middleware";
import { sendPublicChatMessage } from "./chat.controller";

const router = Router();

router.post("/message", publicChatRateLimiter, sendPublicChatMessage);

export default router;
