import { Router } from "express";
import { Permission } from "@prisma/client";
import { authenticate, requireAnyPermission } from "../../middleware/auth.middleware";
import { publicFormRateLimiter } from "../../middleware/rateLimit.middleware";
import {
  createAdminDemoSession,
  createPublicDemoBooking,
  deleteAdminDemoBooking,
  deleteAdminDemoSession,
  getAdminDemoBookings,
  getAdminDemoSessions,
  getAdminDemoSettings,
  getPublicDemo,
  replyAdminDemoBooking,
  updateAdminDemoBooking,
  updateAdminDemoSession,
  updateAdminDemoSettings,
  verifyPublicDemoPayment,
} from "./demo.controller";

export const publicDemoRouter = Router();
publicDemoRouter.get("/", getPublicDemo);
publicDemoRouter.post("/bookings", publicFormRateLimiter, createPublicDemoBooking);
publicDemoRouter.post("/bookings/verify", publicFormRateLimiter, verifyPublicDemoPayment);

export const adminDemoRouter = Router();
adminDemoRouter.use(
  authenticate,
  requireAnyPermission(Permission.MANAGE_WEBSITE, Permission.MANAGE_COMMUNICATION),
);
adminDemoRouter.get("/settings", getAdminDemoSettings);
adminDemoRouter.put("/settings", updateAdminDemoSettings);
adminDemoRouter.get("/sessions", getAdminDemoSessions);
adminDemoRouter.post("/sessions", createAdminDemoSession);
adminDemoRouter.put("/sessions/:id", updateAdminDemoSession);
adminDemoRouter.delete("/sessions/:id", deleteAdminDemoSession);
adminDemoRouter.get("/bookings", getAdminDemoBookings);
adminDemoRouter.patch("/bookings/:id", updateAdminDemoBooking);
adminDemoRouter.post("/bookings/:id/reply", replyAdminDemoBooking);
adminDemoRouter.delete("/bookings/:id", deleteAdminDemoBooking);
