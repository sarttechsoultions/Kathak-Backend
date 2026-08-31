import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, requireRole } from "../../middleware/auth.middleware";
import {
  createLetterhead,
  createLetterheadTemplate,
  deleteLetterhead,
  deleteLetterheadTemplate,
  getLetterheadById,
  getLetterheadTemplates,
  getLetterheads,
  trackLetterheadDownload,
  updateLetterhead,
  updateLetterheadTemplate,
} from "./letterhead.controller";

export const adminLetterheadRouter = Router();

adminLetterheadRouter.use(authenticate, requireRole(Role.ADMIN));

adminLetterheadRouter.get("/templates", getLetterheadTemplates);
adminLetterheadRouter.post("/templates", createLetterheadTemplate);
adminLetterheadRouter.put("/templates/:id", updateLetterheadTemplate);
adminLetterheadRouter.delete("/templates/:id", deleteLetterheadTemplate);

adminLetterheadRouter.get("/", getLetterheads);
adminLetterheadRouter.get("/:id", getLetterheadById);
adminLetterheadRouter.post("/", createLetterhead);
adminLetterheadRouter.put("/:id", updateLetterhead);
adminLetterheadRouter.delete("/:id", deleteLetterhead);
adminLetterheadRouter.post("/:id/track-download", trackLetterheadDownload);
