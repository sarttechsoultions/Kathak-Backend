import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, requireRole } from "../../middleware/auth.middleware";
import {
  getPublicGallery,
  getAdminGallery,
  createGalleryItem,
  updateGalleryItem,
  deleteGalleryItem,
} from "./gallery.controller";

export const publicGalleryRouter = Router();
publicGalleryRouter.get("/", getPublicGallery);

export const adminGalleryRouter = Router();
adminGalleryRouter.use(authenticate, requireRole(Role.ADMIN));
adminGalleryRouter.get("/", getAdminGallery);
adminGalleryRouter.post("/", createGalleryItem);
adminGalleryRouter.put("/:id", updateGalleryItem);
adminGalleryRouter.delete("/:id", deleteGalleryItem);
