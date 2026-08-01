import { Router } from "express";
import { enrollStudent } from "./student.controller";

const router = Router();

// Public Student Enrollment & Course Purchase Route
router.post("/enroll", enrollStudent);

export default router;
