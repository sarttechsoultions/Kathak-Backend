import { Router } from "express";
import { Role } from "@prisma/client";
import {
  getFeaturedEvent,
  getUpcomingEvents,
  getEventDetailsForStudent,
  registerForEvent,
  cancelEventRegistration,
  getMyRegistrations,
  getCalendarEvents,
} from "./student.event.controller";

import { authenticate, requireRole } from "../../middleware/auth.middleware";

const router = Router();

router.use(authenticate, requireRole(Role.STUDENT));

// Hero banner
router.get("/featured", getFeaturedEvent);

// Dashboard - Upcoming Workshops grid/list
router.get("/upcoming", getUpcomingEvents);

// My Registrations section
router.get("/my-registrations", getMyRegistrations);

// Calendar widget
router.get("/calendar", getCalendarEvents);

// Single event details (AFTER specific routes to avoid /:id conflicts)
router.get("/:id", getEventDetailsForStudent);

// Register / Cancel
router.post("/:id/register", registerForEvent);
router.delete("/:id/register", cancelEventRegistration);

export default router;