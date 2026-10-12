import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, requireRole } from "../../middleware/auth.middleware";
import {
  getPublicBanners,
  getPublicBannerByPage,
  getAdminBanners,
  updateAdminBanner,
  getPublicMobileBanners,
  getAdminMobileBanners,
  createAdminMobileBanner,
  updateAdminMobileBanner,
  deleteAdminMobileBanner,
} from "./banners.controller";

export const publicBannersRouter = Router();
publicBannersRouter.get("/", getPublicBanners);
publicBannersRouter.get("/mobile", getPublicMobileBanners);
publicBannersRouter.get("/:pageKey", getPublicBannerByPage);

export const adminBannersRouter = Router();
adminBannersRouter.use(authenticate, requireRole(Role.ADMIN));
adminBannersRouter.get("/", getAdminBanners);
adminBannersRouter.get("/mobile", getAdminMobileBanners);
adminBannersRouter.post("/mobile", createAdminMobileBanner);
adminBannersRouter.put("/mobile/:id", updateAdminMobileBanner);
adminBannersRouter.delete("/mobile/:id", deleteAdminMobileBanner);
adminBannersRouter.put("/:pageKey", updateAdminBanner);
