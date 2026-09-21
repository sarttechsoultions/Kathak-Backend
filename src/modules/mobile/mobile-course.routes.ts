import { Router } from "express";
import { getCourseForEnrollmentBySlug } from "./mobile-course.controller";
import { getMobileDashboard } from "./mobile-dashboard.controller";
import { authenticate, requireRole } from "../../middleware/auth.middleware";
import { Role } from "@prisma/client";

const router = Router();

router.get("/dashboard", authenticate, requireRole(Role.STUDENT), getMobileDashboard);

// Endpoint for mobile enrollment data (raw course + active batches)
router.get("/enroll/:slug", getCourseForEnrollmentBySlug);

export default router;
