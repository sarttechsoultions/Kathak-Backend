import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, requireRole } from "../../middleware/auth.middleware";
import { getPublicPopup, getAdminPopup, updateAdminPopup } from "./popup.controller";

export const publicPopupRouter = Router();
publicPopupRouter.get("/", getPublicPopup);

export const adminPopupRouter = Router();
adminPopupRouter.use(authenticate, requireRole(Role.ADMIN));
adminPopupRouter.get("/", getAdminPopup);
adminPopupRouter.put("/", updateAdminPopup);
