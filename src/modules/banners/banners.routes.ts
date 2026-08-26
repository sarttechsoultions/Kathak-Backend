import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, requireRole } from "../../middleware/auth.middleware";
import {
  getPublicBanners,
  getPublicBannerByPage,
  getAdminBanners,
  updateAdminBanner,
} from "./banners.controller";

export const publicBannersRouter = Router();
publicBannersRouter.get("/", getPublicBanners);
publicBannersRouter.get("/:pageKey", getPublicBannerByPage);

export const adminBannersRouter = Router();
adminBannersRouter.use(authenticate, requireRole(Role.ADMIN));
adminBannersRouter.get("/", getAdminBanners);
adminBannersRouter.put("/:pageKey", updateAdminBanner);
