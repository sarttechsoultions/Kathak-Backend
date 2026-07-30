import { Router } from "express";
import { Role } from "@prisma/client";
import {
  getDashboardStats,
  getStudents,
  getTeachers,
  createTeacher,
  deleteTeacher,
  getBatches,
  createBatch,
  updateBatch,
  deleteBatch,
  getBatchStudents
} from "./admin.controller";
import { authenticate, requireRole } from "../../middleware/auth.middleware";

const router = Router();

router.use(authenticate, requireRole(Role.ADMIN));

router.get("/dashboard", getDashboardStats);
router.get("/students", getStudents);
router.get("/teachers", getTeachers);
router.post("/teachers", createTeacher);
router.delete("/teachers/:id", deleteTeacher);

// Batch Management Routes
router.get("/batches", getBatches);
router.post("/batches", createBatch);
router.put("/batches/:id", updateBatch);
router.delete("/batches/:id", deleteBatch);
router.get("/batches/:id/students", getBatchStudents);

export default router;
