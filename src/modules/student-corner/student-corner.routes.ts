import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, requireRole } from "../../middleware/auth.middleware";
import {
  getPublicStudentCorner,
  getAdminStudentCorner,
  createStudentCornerItem,
  updateStudentCornerItem,
  deleteStudentCornerItem,
} from "./student-corner.controller";

export const publicStudentCornerRouter = Router();
publicStudentCornerRouter.get("/", getPublicStudentCorner);

export const adminStudentCornerRouter = Router();
adminStudentCornerRouter.use(authenticate, requireRole(Role.ADMIN));
adminStudentCornerRouter.get("/", getAdminStudentCorner);
adminStudentCornerRouter.post("/", createStudentCornerItem);
adminStudentCornerRouter.put("/:id", updateStudentCornerItem);
adminStudentCornerRouter.delete("/:id", deleteStudentCornerItem);
