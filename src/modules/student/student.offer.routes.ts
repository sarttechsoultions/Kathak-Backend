import { Router } from "express";
import { Role } from "@prisma/client";
import { getActiveOffer } from "./student.offer.controller";
import { authenticate, requireRole } from "../../middleware/auth.middleware";

const router = Router();

router.use(authenticate);
router.use(requireRole(Role.STUDENT));

router.get("/active", getActiveOffer);

export default router;
