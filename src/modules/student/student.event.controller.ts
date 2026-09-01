import { Request, Response } from "express";
import { EventCategory, EventStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { bookedSeats } from "../events/ticket.service";

const FILLING_FAST_THRESHOLD = 0.75;

const VISIBLE_STATUSES: EventStatus[] = [EventStatus.SCHEDULED, EventStatus.LIVE];

function toPriceLabel(fee: number): string {
  return fee > 0 ? `₹${fee.toLocaleString("en-IN")}` : "Free";
}

async function getStudentEmail(studentId?: string): Promise<string | null> {
  if (!studentId) return null;
  const user = await prisma.user.findUnique({
    where: { id: studentId },
    select: { email: true },
  });
  return user?.email?.trim().toLowerCase() || null;
}

async function studentHasPaidTicket(eventId: string, studentEmail: string | null): Promise<boolean> {
  if (!studentEmail) return false;
  const ticket = await prisma.eventTicket.findFirst({
    where: {
      eventId,
      paymentStatus: PaymentStatus.SUCCESS,
      email: { equals: studentEmail, mode: "insensitive" },
    },
  });
  return !!ticket;
}

function buildRegistrationBadge(event: { status: EventStatus; startDate: Date }) {
  const now = new Date();
  if (event.status === EventStatus.CANCELLED) return "Cancelled";
  if (event.status === EventStatus.COMPLETED || event.startDate < now) return "Completed";
  if (event.startDate <= now) return "Confirmed";
  return "Upcoming";
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
        registrations: { where: { studentId }, select: { id: true } },
      },
      orderBy: { startDate: "asc" },
    });

    const studentEmail = await getStudentEmail(studentId);

    const data = await Promise.all(
      events.map(async (event: any) => {
        const hasRegistration = event.registrations.length > 0;
        const hasTicket = await studentHasPaidTicket(event.id, studentEmail);
        const seatsTaken = await bookedSeats(event.id);

        return {
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
          isRegistered: hasRegistration || hasTicket,
          canCancel: hasRegistration,
          fillingFast: event.capacity > 0 && seatsTaken / event.capacity >= FILLING_FAST_THRESHOLD,
        };
      }),
    );

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

    const { registrations, _count, ...rest } = event as any;
    const studentEmail = await getStudentEmail(studentId);
    const hasRegistration = registrations.length > 0;
    const hasTicket = await studentHasPaidTicket(event.id, studentEmail);
    const seatsTaken = await bookedSeats(event.id);

    res.status(200).json({
      success: true,
      data: {
        ...rest,
        priceLabel: toPriceLabel(event.registrationFee),
        isRegistered: hasRegistration || hasTicket,
        canCancel: hasRegistration,
        registeredAt: registrations[0]?.registeredAt || null,
        seatsLeft: Math.max(event.capacity - seatsTaken, 0),
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
    });

    const studentEmail = await getStudentEmail(studentId);
    const ticketRows = studentEmail
      ? await prisma.eventTicket.findMany({
          where: {
            paymentStatus: PaymentStatus.SUCCESS,
            email: { equals: studentEmail, mode: "insensitive" },
          },
          include: {
            event: {
              select: { id: true, title: true, category: true, startDate: true, startTime: true, status: true },
            },
          },
          orderBy: { createdAt: "desc" },
        })
      : [];

    const registrationEventIds = new Set(registrations.map((reg) => reg.event.id));

    const ticketEntries = ticketRows
      .filter((ticket) => !registrationEventIds.has(ticket.event.id))
      .map((ticket) => ({
        id: ticket.id,
        eventId: ticket.event.id,
        title: ticket.event.title,
        category: ticket.event.category,
        startDate: ticket.event.startDate,
        startTime: ticket.event.startTime,
        registeredAt: ticket.createdAt,
        badge: buildRegistrationBadge(ticket.event),
      }));

    const registrationEntries = registrations.map((reg: any) => ({
      id: reg.id,
      eventId: reg.event.id,
      title: reg.event.title,
      category: reg.event.category,
      startDate: reg.event.startDate,
      startTime: reg.event.startTime,
      registeredAt: reg.registeredAt,
      badge: buildRegistrationBadge(reg.event),
    }));

    const merged = [...registrationEntries, ...ticketEntries].sort(
      (a, b) => new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime(),
    );

    const data = limit ? merged.slice(0, limit) : merged;

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
        event: { select: { id: true, title: true, startDate: true, startTime: true } },
      },
      orderBy: { event: { startDate: "asc" } },
    });

    const studentEmail = await getStudentEmail(studentId);
    const ticketRows = studentEmail
      ? await prisma.eventTicket.findMany({
          where: {
            paymentStatus: PaymentStatus.SUCCESS,
            email: { equals: studentEmail, mode: "insensitive" },
            event: { startDate: { gte: monthStart, lte: monthEnd } },
          },
          include: {
            event: { select: { id: true, title: true, startDate: true, startTime: true } },
          },
          orderBy: { event: { startDate: "asc" } },
        })
      : [];

    const seenEventIds = new Set<string>();
    const calendarItems = [...registrations, ...ticketRows]
      .filter((row) => {
        const eventId = row.event.id;
        if (seenEventIds.has(eventId)) return false;
        seenEventIds.add(eventId);
        return true;
      })
      .sort((a, b) => a.event.startDate.getTime() - b.event.startDate.getTime());

    const eventDates = calendarItems.map((r: any) => r.event.startDate.getDate());

    const now = new Date();
    const nextReminder = calendarItems.find((r: any) => r.event.startDate >= now);

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