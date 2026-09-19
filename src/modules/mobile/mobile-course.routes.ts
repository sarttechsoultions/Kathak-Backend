import { Router } from "express";
import { getCourseForEnrollmentBySlug } from "./mobile-course.controller";

const router = Router();

// Endpoint for mobile enrollment data (raw course + active batches)
router.get("/enroll/:slug", getCourseForEnrollmentBySlug);

export default router;
