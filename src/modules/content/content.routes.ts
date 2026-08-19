import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, requireRole } from "../../middleware/auth.middleware";
import {
  getAllContentAdmin,
  getStudentContent,
  createContentResource,
  deleteContentResource
} from "./content.controller";

const router = Router();

// Admin routes
router.get("/admin", authenticate, requireRole(Role.ADMIN), getAllContentAdmin);
router.post("/", authenticate, requireRole(Role.ADMIN), createContentResource);
router.delete("/:id", authenticate, requireRole(Role.ADMIN), deleteContentResource);

// Student routes
router.get("/student", authenticate, requireRole(Role.STUDENT), getStudentContent);

export default router;
