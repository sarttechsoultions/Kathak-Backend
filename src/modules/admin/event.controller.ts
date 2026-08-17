import { EventCategory, EventLevel, EventStatus, Prisma, Role } from "@prisma/client";
import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

const EVENT_CATEGORIES = Object.values(EventCategory) as EventCategory[];
const EVENT_LEVELS = Object.values(EventLevel) as EventLevel[];
const EVENT_STATUSES = Object.values(EventStatus) as EventStatus[];

const EVENT_WRITABLE_FIELDS = new Set([
  "title",
  "category",
  "description",
  "startDate",
  "endDate",
  "startTime",
  "durationMins",
  "leadInstructorId",
  "capacity",
  "level",
  "registrationFee",
  "locationOrLink",
  "status",
  "isFeatured",
  "badgeTag",
  "bannerImage",
  "thumbnailImage",
]);

class ValidationError extends Error {}

type EventCreateData = {
  title: string;
  category: EventCategory;
  description: string;
  startDate: Date;
  endDate: Date;
  startTime: string;
  durationMins: number;
  leadInstructorId: string | null;
  capacity: number;
  level: EventLevel;
  registrationFee: number;
  locationOrLink: string;
  status: EventStatus;
  isFeatured: boolean;
  badgeTag: string | null;
  bannerImage: string | null;
  thumbnailImage: string | null;
  createdById: string;
};

type EventUpdateData = Partial<Omit<EventCreateData, "createdById">>;

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function getRequestBody(req: Request): Record<string, unknown> {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw new ValidationError("A JSON object is required in the request body.");
  }

  return req.body as Record<string, unknown>;
}

function assertOnlyEventFields(body: Record<string, unknown>): void {
  const unsupportedFields = Object.keys(body).filter((field) => !EVENT_WRITABLE_FIELDS.has(field));
  if (unsupportedFields.length > 0) {
    throw new ValidationError(`Unsupported event field(s): ${unsupportedFields.join(", ")}.`);
  }
}

function parseRequiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} is required.`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new ValidationError(`${field} is required.`);
  }

  if (normalized.length > maxLength) {
    throw new ValidationError(`${field} must not exceed ${maxLength} characters.`);
  }

  return normalized;
}

function parseOptionalText(
  body: Record<string, unknown>,
  field: string,
  maxLength: number,
): string | null | undefined {
  if (!hasOwn(body, field)) return undefined;

  const value = body[field];
  if (value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string or null.`);
  }

  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new ValidationError(`${field} must not exceed ${maxLength} characters.`);
  }

  return normalized;
}

function parseOptionalId(body: Record<string, unknown>, field: string): string | null | undefined {
  if (!hasOwn(body, field)) return undefined;

  const value = body[field];
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${field} must be a valid identifier or null.`);
  }

  return value.trim();
}

function parseNumber(
  value: unknown,
  field: string,
  { min, integer = false }: { min: number; integer?: boolean },
): number {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(normalized) || normalized < min || (integer && !Number.isInteger(normalized))) {
    const qualifier = integer ? "a whole number" : "a number";
    throw new ValidationError(`${field} must be ${qualifier} greater than or equal to ${min}.`);
  }

  return normalized;
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;

  throw new ValidationError(`${field} must be true or false.`);
}

function parseEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ValidationError(`${field} is invalid.`);
  }

  return value as T;
}

function parseEventDate(value: unknown, field: string): Date {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${field} is required and must be a valid date.`);
  }

  const normalized = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);

  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

    if (
      date.getUTCFullYear() !== Number(year) ||
      date.getUTCMonth() !== Number(month) - 1 ||
      date.getUTCDate() !== Number(day)
    ) {
      throw new ValidationError(`${field} must be a valid date.`);
    }

    return date;
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`${field} must be a valid date.`);
  }

  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseStartTime(value: unknown): string {
  const startTime = parseRequiredText(value, "startTime", 5);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
    throw new ValidationError("startTime must use 24-hour HH:mm format.");
  }

  return startTime;
}

function assertValidDateRange(startDate: Date, endDate: Date): void {
  if (startDate.getTime() > endDate.getTime()) {
    throw new ValidationError("endDate must be on or after startDate.");
  }
}

function parseCreateData(body: Record<string, unknown>, createdById: string): EventCreateData {
  assertOnlyEventFields(body);

  const startDate = parseEventDate(body.startDate, "startDate");
  const endDate = parseEventDate(body.endDate, "endDate");
  assertValidDateRange(startDate, endDate);

  return {
    title: parseRequiredText(body.title, "title", 200),
    category: hasOwn(body, "category")
      ? parseEnum(body.category, "category", EVENT_CATEGORIES)
      : EventCategory.Workshop,
    description: parseRequiredText(body.description, "description", 10_000),
    startDate,
    endDate,
    startTime: parseStartTime(body.startTime),
    durationMins: hasOwn(body, "durationMins")
      ? parseNumber(body.durationMins, "durationMins", { min: 1, integer: true })
      : 60,
    leadInstructorId: parseOptionalId(body, "leadInstructorId") ?? null,
    capacity: parseNumber(body.capacity, "capacity", { min: 1, integer: true }),
    level: hasOwn(body, "level")
      ? parseEnum(body.level, "level", EVENT_LEVELS)
      : EventLevel.Beginner,
    registrationFee: hasOwn(body, "registrationFee")
      ? parseNumber(body.registrationFee, "registrationFee", { min: 0 })
      : 0,
    locationOrLink: parseRequiredText(body.locationOrLink, "locationOrLink", 1_000),
    status: hasOwn(body, "status")
      ? parseEnum(body.status, "status", EVENT_STATUSES)
      : EventStatus.DRAFT,
    isFeatured: hasOwn(body, "isFeatured") ? parseBoolean(body.isFeatured, "isFeatured") : false,
    badgeTag: parseOptionalText(body, "badgeTag", 100) ?? null,
    bannerImage: parseOptionalText(body, "bannerImage", 2_048) ?? null,
    thumbnailImage: parseOptionalText(body, "thumbnailImage", 2_048) ?? null,
    createdById,
  };
}

function parseUpdateData(body: Record<string, unknown>): EventUpdateData {
  assertOnlyEventFields(body);
  if (Object.keys(body).length === 0) {
    throw new ValidationError("Provide at least one event field to update.");
  }

  const data: EventUpdateData = {};

  if (hasOwn(body, "title")) data.title = parseRequiredText(body.title, "title", 200);
  if (hasOwn(body, "category")) data.category = parseEnum(body.category, "category", EVENT_CATEGORIES);
  if (hasOwn(body, "description")) data.description = parseRequiredText(body.description, "description", 10_000);
  if (hasOwn(body, "startDate")) data.startDate = parseEventDate(body.startDate, "startDate");
  if (hasOwn(body, "endDate")) data.endDate = parseEventDate(body.endDate, "endDate");
  if (hasOwn(body, "startTime")) data.startTime = parseStartTime(body.startTime);
  if (hasOwn(body, "durationMins")) {
    data.durationMins = parseNumber(body.durationMins, "durationMins", { min: 1, integer: true });
  }
  if (hasOwn(body, "leadInstructorId")) data.leadInstructorId = parseOptionalId(body, "leadInstructorId");
  if (hasOwn(body, "capacity")) data.capacity = parseNumber(body.capacity, "capacity", { min: 1, integer: true });
  if (hasOwn(body, "level")) data.level = parseEnum(body.level, "level", EVENT_LEVELS);
  if (hasOwn(body, "registrationFee")) {
    data.registrationFee = parseNumber(body.registrationFee, "registrationFee", { min: 0 });
  }
  if (hasOwn(body, "locationOrLink")) {
    data.locationOrLink = parseRequiredText(body.locationOrLink, "locationOrLink", 1_000);
  }
  if (hasOwn(body, "status")) data.status = parseEnum(body.status, "status", EVENT_STATUSES);
  if (hasOwn(body, "isFeatured")) data.isFeatured = parseBoolean(body.isFeatured, "isFeatured");
  if (hasOwn(body, "badgeTag")) data.badgeTag = parseOptionalText(body, "badgeTag", 100);
  if (hasOwn(body, "bannerImage")) data.bannerImage = parseOptionalText(body, "bannerImage", 2_048);
  if (hasOwn(body, "thumbnailImage")) {
    data.thumbnailImage = parseOptionalText(body, "thumbnailImage", 2_048);
  }

  return data;
}

async function assertLeadInstructorIsActiveTeacher(leadInstructorId: string | null | undefined): Promise<void> {
  if (!leadInstructorId) return;

  const instructor = await prisma.user.findFirst({
    where: {
      id: leadInstructorId,
      role: Role.TEACHER,
      isActive: true,
    },
    select: { id: true },
  });

  if (!instructor) {
    throw new ValidationError("leadInstructorId must reference an active teacher.");
  }
}

function getEventId(req: Request): string {
  const id = getSingleQueryValue(req.params.id, "event id")?.trim();
  if (!id) throw new ValidationError("A valid event id is required.");
  return id;
}

function getSingleQueryValue(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a single value.`);
  }
  return value;
}

function sendError(res: Response, error: unknown, fallbackMessage: string): void {
  if (error instanceof ValidationError) {
    res.status(400).json({ success: false, message: error.message });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") {
      res.status(404).json({ success: false, message: "Event not found." });
      return;
    }

    if (error.code === "P2002" || error.code === "P2003") {
      res.status(409).json({ success: false, message: "This event operation conflicts with existing data." });
      return;
    }
  }

  console.error("Admin event controller error:", error);
  res.status(500).json({ success: false, message: fallbackMessage });
}
// ==========================================
// 1. Get Dashboard Stats (For Top 3 Cards)
// ==========================================
export const getEventStats = async (req: Request, res: Response) => {
  try {
    const totalEvents = await prisma.event.count();

    const activeWorkshops = await prisma.event.count({
      where: {
        category: "Workshop",
        status: "LIVE",
      },
    });

    // Get today's start time to count "New Registrations today"
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const newRegistrations = await prisma.eventRegistration.count({
      where: {
        registeredAt: {
          gte: startOfToday,
        },
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        totalEvents,
        activeWorkshops,
        newRegistrations,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 2. Get All Events (For Table & Filters)
// ==========================================
export const getAllEvents = async (req: Request, res: Response) => {
  try {
    const { category, status } = req.query;

    const filter: any = {};
    if (category && category !== 'All') filter.category = category;
    if (status && status !== 'All Statuses') filter.status = status;

    const events = await prisma.event.findMany({
      where: filter,
      include: {
        // UI mein instructor ka naam aur image dikhane ke liye
        leadInstructor: {
          select: {
            fullName: true,
            avatarUrl: true,
          },
        },
        // UI mein "REG." column mein count dikhane ke liye
        _count: {
          select: { registrations: true },
        },
      },
      orderBy: {
        startDate: "desc", // Newest events first
      },
    });

    return res.status(200).json({ success: true, data: events });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 3. Create New Event (Event Orchestrator)
// ==========================================
export const createEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req as any).user?.id;
    if (!adminId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const data = parseCreateData(getRequestBody(req), adminId);
    await assertLeadInstructorIsActiveTeacher(data.leadInstructorId);

    const newEvent = await prisma.event.create({ data });

    // Broadcast Notification to all Active Students
    try {
      const students = await prisma.user.findMany({
        where: { role: "STUDENT", isActive: true },
        select: { id: true },
      });

      if (students.length > 0) {
        const notifications = students.map(student => ({
          userId: student.id,
          type: "ANNOUNCEMENT",
          title: `New Event: ${newEvent.title}`,
          message: `A new event "${newEvent.title}" has been scheduled for ${new Date(newEvent.startDate).toLocaleDateString()}. Check it out!`,
          link: "/student/events",
        }));
        
        await prisma.notification.createMany({ data: notifications });
      }
    } catch (notifErr) {
      console.error("Failed to send event notifications to students:", notifErr);
    }

    res.status(201).json({
      success: true,
      message: "Event created successfully",
      data: newEvent,
    });
  } catch (error) {
    sendError(res, error, "Failed to create event.");
  }
};

// ==========================================
// 4. Update Event (Edit Action)
// ==========================================
export const updateEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = getEventId(req);
    const body = getRequestBody(req);
    const data = parseUpdateData(body);

    const existing = await prisma.event.findUnique({
      where: { id },
      select: { startDate: true, endDate: true },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: "Event not found." });
      return;
    }

    const startDate = data.startDate ?? existing.startDate;
    const endDate = data.endDate ?? existing.endDate;
    assertValidDateRange(startDate, endDate);

    if (hasOwn(body, "leadInstructorId")) {
      await assertLeadInstructorIsActiveTeacher(data.leadInstructorId);
    }

    const updatedEvent = await prisma.event.update({
      where: { id },
      data,
    });

    // Broadcast Notification to all Active Students
    try {
      const students = await prisma.user.findMany({
        where: { role: "STUDENT", isActive: true },
        select: { id: true },
      });

      if (students.length > 0) {
        const notifications = students.map(student => ({
          userId: student.id,
          type: "ANNOUNCEMENT",
          title: `Event Updated: ${updatedEvent.title}`,
          message: `The event "${updatedEvent.title}" has been updated. The new schedule is ${new Date(updatedEvent.startDate).toLocaleDateString()}.`,
          link: "/student/events",
        }));
        
        await prisma.notification.createMany({ data: notifications });
      }
    } catch (notifErr) {
      console.error("Failed to send event update notifications to students:", notifErr);
    }

    res.status(200).json({
      success: true,
      message: "Event updated successfully",
      data: updatedEvent,
    });
  } catch (error) {
    sendError(res, error, "Failed to update event.");
  }
};

// ==========================================
// 5. Delete Event (Trash Icon Action)
// ==========================================
export const deleteEvent = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.event.delete({
      where: { id: id as string },
    });

    return res.status(200).json({ success: true, message: "Event deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};


// ==========================================
// 6. Get Single Event By ID (For Edit Form)
// ==========================================
export const getEventById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const event = await prisma.event.findUnique({
      where: { id: id as string },
      include: {
        leadInstructor: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
    });

    if (!event) {
      res.status(404).json({ success: false, message: "Event not found" });
      return;
    }

    res.status(200).json({
      success: true,
      data: event,
    });
  } catch (error: any) {
    console.error("Get Event By ID Error:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to fetch event details." });
  }
};

export const getEventAttendees = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: eventId } = req.params;

    // Event title aur registrations (student details ke sath) fetch karein
    const event = await prisma.event.findUnique({
      where: { id: eventId as string },
      select: {
        title: true,
        registrations: {
          include: {
            student: {
              select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
                avatarUrl: true
              }
            }
          },
          orderBy: { registeredAt: 'desc' }
        }
      }
    });

    if (!event) {
      res.status(404).json({ success: false, message: "Event not found" });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        title: event.title,
        registrations: event.registrations
      }
    });
  } catch (error: any) {
    console.error("Get Event Attendees Error:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to fetch attendees." });
  }
};
