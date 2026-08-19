import { Router } from "express";
import { authenticate, requirePermission } from "../../middleware/auth.middleware";
import { createSupportTicket } from "./support.controller";
import { forwardToDeveloper } from "./support.controller";
const router = Router();

// Protected route for logged in users (students and teachers)
router.post("/ticket", authenticate, createSupportTicket);
router.post("/:id/forward-dev", authenticate, requirePermission('MANAGE_COMMUNICATION'), forwardToDeveloper);

export default router;
