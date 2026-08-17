import { Router } from "express";
import { Role } from "@prisma/client";
import {
  getEventStats,
  getAllEvents,
  getEventById,
//   getEventRegistrations,
  getEventAttendees,
  createEvent,
  updateEvent,
  deleteEvent
} from "./event.controller";

// Aapki file ke actual function names import karein
import { authenticate, requireRole } from "../../middleware/auth.middleware";

const router = Router();

// Sahi middleware functions apply karein
router.use(authenticate);
router.use(requireRole(Role.ADMIN)); 

// Dashboard Top Cards
router.get("/stats", getEventStats);

// Event Table & Filters
router.get("/", getAllEvents);

// Event Orchestrator (Create & Manage)
router.post("/", createEvent);
router.get("/:id", getEventById);
// router.get("/:id/registrations", getEventRegistrations);
router.get("/:id/attendees", getEventAttendees);
router.put("/:id", updateEvent);
router.delete("/:id", deleteEvent);

export default router;
