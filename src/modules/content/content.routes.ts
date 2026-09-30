import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, requireRole } from "../../middleware/auth.middleware";
import { requireActiveStudentAccess } from "../../middleware/access.middleware";
import {
  getAllContentAdmin,
  getStudentContent,
  downloadStudentContent,
  serveContentResource,
  createContentResource,
  deleteContentResource
} from "./content.controller";

const router = Router();

// Admin routes
router.get("/admin", authenticate, requireRole(Role.ADMIN), getAllContentAdmin);
router.get("/teacher", authenticate, requireRole(Role.TEACHER), getAllContentAdmin);
router.post("/", authenticate, requireRole(Role.ADMIN, Role.TEACHER), createContentResource);
router.get("/:id/preview", authenticate, requireRole(Role.ADMIN, Role.TEACHER, Role.STUDENT), requireActiveStudentAccess, serveContentResource);
router.get("/:id/download", authenticate, requireRole(Role.ADMIN, Role.TEACHER, Role.STUDENT), requireActiveStudentAccess, serveContentResource);
router.delete("/:id", authenticate, requireRole(Role.ADMIN, Role.TEACHER), deleteContentResource);

// Student routes
router.get("/student", authenticate, requireRole(Role.STUDENT), requireActiveStudentAccess, getStudentContent);
router.get("/student/:id/download", authenticate, requireRole(Role.STUDENT), requireActiveStudentAccess, downloadStudentContent);

export default router;
