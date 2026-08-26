import { Request, Response } from "express";
import { EventCategory, EventStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";

const FILLING_FAST_THRESHOLD = 0.75; // 75% seats bhar jaye to "Filling Fast" badge

// Student ko sirf ye statuses dikhne chahiye — DRAFT abhi publish nahi hua,
// COMPLETED/CANCELLED "upcoming" list mein nahi aane chahiye
const VISIBLE_STATUSES: EventStatus[] = [EventStatus.SCHEDULED, EventStatus.LIVE];

function toPriceLabel(fee: number): string {
  return fee > 0 ? `₹${fee.toLocaleString("en-IN")}` : "Free";
}

// ==========================================================
// 1. Get Hero Featured Event (Top Banner with Countdown)
// ==========================================================
export const getFeaturedEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    let event = await prisma.event.findFirst({
      where: {
        isFeatured: true,
        status: { in: VISIBLE_STATUSES },
        startDate: { gte: new Date() },
      },
      include: {
        leadInstructor: { select: { fullName: true, avatarUrl: true } },
        _count: { select: { registrations: true } },
      },
      orderBy: { startDate: "asc" },
    });

    // Koi featured event nahi mila to sabse nazdeeki upcoming event le lo (fallback)
    if (!event) {
      event = await prisma.event.findFirst({
        where: { status: { in: VISIBLE_STATUSES }, startDate: { gte: new Date() } },
        include: {
          leadInstructor: { select: { fullName: true, avatarUrl: true } },
          _count: { select: { registrations: true } },
        },
        orderBy: { startDate: "asc" },
      });
    }

    if (!event) {
      res.status(200).json({ success: true, data: null });
      return;
    }

    const eventData = event as any;
    const fillingFast = eventData.capacity > 0 && eventData._count.registrations / eventData.capacity >= FILLING_FAST_THRESHOLD;

    // startDate + startTime ko combine karke ek target ISO datetime banate hain (countdown ke liye)
    const [hh, mm] = (eventData.startTime || "00:00").split(":").map(Number);
    const targetDateTime = new Date(eventData.startDate);
    targetDateTime.setUTCHours(hh || 0, mm || 0, 0, 0);

    res.status(200).json({
      success: true,
      data: {
        id: eventData.id,
        title: eventData.title,
        description: eventData.description,
        badgeTag: eventData.badgeTag || "FEATURED",
        fillingFast,
        bannerImage: eventData.bannerImage,
        targetDateTime: targetDateTime.toISOString(),
      },
    });
  } catch (error: any) {
    console.error("Get Featured Event Error:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to fetch featured event." });
  }
};

// ==========================================================
// 2. Get Upcoming Workshops (Dashboard List/Grid)
// ==========================================================
export const getUpcomingEvents = async (req: Request, res: Response) => {
  try {
    const studentId = (req as any).user?.id;
    const { category } = req.query;

    const filter: any = {
      status: { in: VISIBLE_STATUSES },
      startDate: { gte: new Date() },
    };
    // category query param ko EventCategory enum ke against validate karo
    if (category && category !== "All" && ["Event", "Workshop", "Competition", "Seminar"].includes(String(category))) {
      filter.category = category as EventCategory;
    }

    const events = await prisma.event.findMany({
      where: filter,
      include: {
        leadInstructor: { select: { fullName: true, avatarUrl: true } },
        _count: { select: { registrations: true } },
        registrations: { where: { studentId }, select: { id: true } },
      },
      orderBy: { startDate: "asc" },
    });

    const data = events.map((event: any) => ({
      id: event.id,
      title: event.title,
      category: event.category,
      thumbnailImage: event.thumbnailImage,
      priceLabel: toPriceLabel(event.registrationFee),
      isFree: event.registrationFee === 0,
      startDate: event.startDate,
      startTime: event.startTime,
      locationOrLink: event.locationOrLink,
      instructorName: event.leadInstructor?.fullName || null,
      instructorAvatar: event.leadInstructor?.avatarUrl || null,
      isRegistered: event.registrations.length > 0,
      fillingFast: event.capacity > 0 && event._count.registrations / event.capacity >= FILLING_FAST_THRESHOLD,
    }));

    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================================
// 3. Get Single Event Details (Details Modal/Page)
// ==========================================================
export const getEventDetailsForStudent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const studentId = (req as any).user?.id;

    const event = await prisma.event.findUnique({
      where: { id: id as string },
      include: {
        leadInstructor: { select: { id: true, fullName: true, avatarUrl: true } },
        _count: { select: { registrations: true } },
        registrations: { where: { studentId }, select: { id: true, registeredAt: true } },
      },
    });

    if (!event) {
      res.status(404).json({ success: false, message: "Event not found" });
      return;
    }

    const { registrations, ...rest } = event as any;

    res.status(200).json({
      success: true,
      data: {
        ...rest,
        priceLabel: toPriceLabel(event.registrationFee),
        isRegistered: registrations.length > 0,
        registeredAt: registrations[0]?.registeredAt || null,
        seatsLeft: event.capacity - event._count.registrations,
      },
    });
  } catch (error: any) {
    console.error("Get Event Details Error:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to fetch event details." });
  }
};

// ==========================================================
// 4. Register for an Event
// ==========================================================
export const registerForEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: eventId } = req.params;
    const studentId = (req as any).user?.id;

    if (!studentId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const event = await prisma.event.findUnique({
      where: { id: eventId as string },
      include: { _count: { select: { registrations: true } } },
    });

    if (!event) {
      res.status(404).json({ success: false, message: "Event not found" });
      return;
    }

    if (
      event.status === EventStatus.DRAFT ||
      event.status === EventStatus.COMPLETED ||
      event.status === EventStatus.CANCELLED
    ) {
      res.status(400).json({ success: false, message: "Registrations are closed for this event." });
      return;
    }

    const existing = await prisma.eventRegistration.findFirst({
      where: { eventId: eventId as string, studentId },
    });
    if (existing) {
      res.status(409).json({ success: false, message: "You are already registered for this event." });
      return;
    }

    if (event._count.registrations >= event.capacity) {
      res.status(400).json({ success: false, message: "This event is fully booked." });
      return;
    }

    const registration = await prisma.eventRegistration.create({
      data: {
        eventId: eventId as string,
        studentId,
        registeredAt: new Date(),
      },
    });

    res.status(201).json({ success: true, message: "Registered successfully", data: registration });
  } catch (error: any) {
    console.error("Register Event Error:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to register." });
  }
};

// ==========================================================
// 5. Cancel Registration
// ==========================================================
export const cancelEventRegistration = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: eventId } = req.params;
    const studentId = (req as any).user?.id;

    const registration = await prisma.eventRegistration.findFirst({
      where: { eventId: eventId as string, studentId },
    });

    if (!registration) {
      res.status(404).json({ success: false, message: "Registration not found" });
      return;
    }

    await prisma.eventRegistration.delete({ where: { id: registration.id } });

    res.status(200).json({ success: true, message: "Registration cancelled" });
  } catch (error: any) {
    console.error("Cancel Registration Error:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to cancel registration." });
  }
};

// ==========================================================
// 6. Get My Registrations ("My Registrations" section)
//    ?limit=2  -> dashboard preview, default = all
// ==========================================================
export const getMyRegistrations = async (req: Request, res: Response) => {
  try {
    const studentId = (req as any).user?.id;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const registrations = await prisma.eventRegistration.findMany({
      where: { studentId },
      include: {
        event: {
          select: { id: true, title: true, category: true, startDate: true, startTime: true, status: true },
        },
      },
      orderBy: { registeredAt: "desc" },
      ...(limit ? { take: limit } : {}),
    });

    const now = new Date();

    const data = registrations.map((reg: any) => {
      let badge = "Upcoming";
      if (reg.event.status === EventStatus.CANCELLED) {
        badge = "Cancelled";
      } else if (reg.event.status === EventStatus.COMPLETED || reg.event.startDate < now) {
        badge = "Completed";
      } else if (reg.event.startDate <= now) {
        badge = "Confirmed";
      }

      return {
        id: reg.id,
        eventId: reg.event.id,
        title: reg.event.title,
        category: reg.event.category,
        startDate: reg.event.startDate,
        startTime: reg.event.startTime,
        registeredAt: reg.registeredAt,
        badge,
      };
    });

    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================================
// 7. Get Calendar Data (Month Widget)
//    ?month=7&year=2025  (month is 1-indexed)
// ==========================================================
export const getCalendarEvents = async (req: Request, res: Response) => {
  try {
    const studentId = (req as any).user?.id;
    const month = Number(req.query.month) || new Date().getMonth() + 1;
    const year = Number(req.query.year) || new Date().getFullYear();

    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59);

    // Is mahine ke saare events jinme student registered hai (calendar pe rose dot dikhane ke liye)
    const registrations = await prisma.eventRegistration.findMany({
      where: {
        studentId,
        event: { startDate: { gte: monthStart, lte: monthEnd } },
      },
      include: {
        event: { select: { title: true, startDate: true, startTime: true } },
      },
      orderBy: { event: { startDate: "asc" } },
    });

    const eventDates = registrations.map((r: any) => r.event.startDate.getDate());

    const now = new Date();
    const nextReminder = registrations.find((r: any) => r.event.startDate >= now);

    return res.status(200).json({
      success: true,
      data: {
        month,
        year,
        eventDates: [...new Set(eventDates)],
        nextReminder: nextReminder
          ? {
              title: nextReminder.event.title,
              date: nextReminder.event.startDate,
              time: nextReminder.event.startTime,
            }
          : null,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};