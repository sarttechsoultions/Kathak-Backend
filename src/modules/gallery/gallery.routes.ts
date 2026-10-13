import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, requireRole } from "../../middleware/auth.middleware";
import {
  getPublicGallery,
  getPerformanceSectionSettings,
  getJourneyCarouselSettings,
  getJourneyCarouselItems,
  createJourneyCarouselItem,
  updateJourneyCarouselItem,
  deleteJourneyCarouselItem,
  getAdminGallery,
  createGalleryItem,
  updateGalleryItem,
  deleteGalleryItem,
  updateJourneyCarouselSettings,
  updatePerformanceSectionSettings,
} from "./gallery.controller";

export const publicGalleryRouter = Router();
publicGalleryRouter.get("/", getPublicGallery);
publicGalleryRouter.get("/performance-settings", getPerformanceSectionSettings);
publicGalleryRouter.get("/journey-settings", getJourneyCarouselSettings);
publicGalleryRouter.get("/journey-items", getJourneyCarouselItems);

export const adminGalleryRouter = Router();
adminGalleryRouter.use(authenticate, requireRole(Role.ADMIN));
adminGalleryRouter.get("/", getAdminGallery);
adminGalleryRouter.get("/performance-settings", getPerformanceSectionSettings);
adminGalleryRouter.put("/performance-settings", updatePerformanceSectionSettings);
adminGalleryRouter.get("/journey-settings", getJourneyCarouselSettings);
adminGalleryRouter.put("/journey-settings", updateJourneyCarouselSettings);
adminGalleryRouter.get("/journey-items", getJourneyCarouselItems);
adminGalleryRouter.post("/journey-items", createJourneyCarouselItem);
adminGalleryRouter.put("/journey-items/:id", updateJourneyCarouselItem);
adminGalleryRouter.delete("/journey-items/:id", deleteJourneyCarouselItem);
adminGalleryRouter.post("/", createGalleryItem);
adminGalleryRouter.put("/:id", updateGalleryItem);
adminGalleryRouter.delete("/:id", deleteGalleryItem);
