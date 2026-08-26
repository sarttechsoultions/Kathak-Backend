import { EventCategory, EventStatus } from "@prisma/client";
import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import {
  bookedSeats,
  createEventTicketOrder,
  formatDateRange,
  formatPrice,
  formatTimeRange,
  TicketError,
  verifyEventTicketPayment,
} from "./ticket.service";

const VISIBLE_STATUSES: EventStatus[] = [EventStatus.SCHEDULED, EventStatus.LIVE];
const PUBLIC_CATEGORIES = new Set<string>(["Event", "Workshop", "Competition", "Seminar"]);

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseCategory(value: unknown): EventCategory | null {
  const raw = asString(value);
  if (!raw || !PUBLIC_CATEGORIES.has(raw)) return null;
  return raw as EventCategory;
}

function levelLabel(level: string): { label: string; levelType: "beginner" | "advanced" | "all" } {
  if (level === "Advanced") return { label: "INTERMEDIATE/ADVANCED", levelType: "advanced" };
  if (level === "Intermediate") return { label: "INTERMEDIATE", levelType: "advanced" };
  if (level === "All_Levels") return { label: "ALL LEVELS", levelType: "all" };
  return { label: "BEGINNER FRIENDLY", levelType: "beginner" };
}

function serializeEvent(
  event: {
    id: string;
    title: string;
    category: EventCategory;
    description: string;
    startDate: Date;
    endDate: Date;
    startTime: string;
    durationMins: number;
    capacity: number;
    level: string;
    registrationFee: number;
    locationOrLink: string;
    status: EventStatus;
    thumbnailImage: string | null;
    bannerImage: string | null;
  },
  seatsTaken: number,
) {
  const seatsLeft = Math.max(event.capacity - seatsTaken, 0);
  const available = VISIBLE_STATUSES.includes(event.status) && seatsLeft > 0;
  const level = levelLabel(event.level);
  const dateLabel = formatDateRange(event.startDate, event.endDate);
  const timeLabel = formatTimeRange(event.startTime, event.durationMins);

  return {
    id: event.id,
    title: event.title,
    category: event.category,
    description: event.description,
    image: event.thumbnailImage || event.bannerImage,
    level: level.label,
    levelType: level.levelType,
    date: dateLabel,
    time: timeLabel,
    location: event.locationOrLink,
    price: formatPrice(event.registrationFee),
    fee: event.registrationFee,
    startDate: event.startDate,
    endDate: event.endDate,
    startTime: event.startTime,
    durationMins: event.durationMins,
    capacity: event.capacity,
    seatsLeft,
    status: event.status,
    available,
    buttonText: available ? "REGISTER NOW" : event.status === EventStatus.COMPLETED ? "COMPLETED" : "JOIN WAITLIST",
  };
}

function sendTicketError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof TicketError) {
    res.status(error.statusCode).json({ success: false, message: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : fallback;
  res.status(500).json({ success: false, message });
}

export const listPublicEvents = async (req: Request, res: Response): Promise<void> => {
  try {
    const category = parseCategory(req.query.category);
    const scope = asString(req.query.scope).toLowerCase() || "upcoming";

    const where: {
      category?: EventCategory;
      status?: { in: EventStatus[] } | EventStatus;
      endDate?: { gte: Date };
    } = {};

    if (category) where.category = category;

    if (scope === "completed") {
      where.status = EventStatus.COMPLETED;
    } else {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      where.status = { in: VISIBLE_STATUSES };
      where.endDate = { gte: today };
    }

    const events = await prisma.event.findMany({
      where,
      orderBy: { startDate: scope === "completed" ? "desc" : "asc" },
    });

    const data = await Promise.all(
      events.map(async (event) => serializeEvent(event, await bookedSeats(event.id))),
    );

    res.status(200).json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch events.";
    res.status(500).json({ success: false, message });
  }
};

export const getPublicEventById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const event = await prisma.event.findUnique({ where: { id: id as string } });

    if (!event || event.status === EventStatus.DRAFT || event.status === EventStatus.CANCELLED) {
      res.status(404).json({ success: false, message: "Event not found." });
      return;
    }

    res.status(200).json({
      success: true,
      data: serializeEvent(event, await bookedSeats(event.id)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch event.";
    res.status(500).json({ success: false, message });
  }
};

export const purchaseEventTicket = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await createEventTicketOrder(String(req.params.id), (req.body || {}) as Record<string, unknown>);

    if (!result.needsPayment) {
      res.status(201).json({
        success: true,
        message: result.confirmation.emailSent
          ? "Booking confirmed. Your ticket has been emailed."
          : "Booking confirmed.",
        data: result.confirmation,
      });
      return;
    }

    res.status(201).json({
      success: true,
      message: "Payment order created.",
      data: result.order,
    });
  } catch (error) {
    sendTicketError(res, error, "Failed to complete booking.");
  }
};

export const verifyPublicEventTicket = async (req: Request, res: Response): Promise<void> => {
  try {
    const confirmation = await verifyEventTicketPayment(
      String(req.params.id),
      (req.body || {}) as Record<string, unknown>,
    );

    res.status(200).json({
      success: true,
      message: confirmation.emailSent
        ? "Payment confirmed. Your ticket has been emailed."
        : "Payment confirmed.",
      data: confirmation,
    });
  } catch (error) {
    sendTicketError(res, error, "Failed to verify ticket payment.");
  }
};
