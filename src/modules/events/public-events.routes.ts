import { Router } from "express";
import {
  getPublicEventById,
  listPublicEvents,
  purchaseEventTicket,
  verifyPublicEventTicket,
} from "./public-events.controller";

export const publicEventsRouter = Router();

publicEventsRouter.get("/", listPublicEvents);
publicEventsRouter.get("/:id", getPublicEventById);
publicEventsRouter.post("/:id/tickets/verify", verifyPublicEventTicket);
publicEventsRouter.post("/:id/tickets", purchaseEventTicket);
