import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { createSupportTicket } from "./support.controller";

const router = Router();

// Protected route for logged in users (students and teachers)
router.post("/ticket", authenticate, createSupportTicket);

export default router;
