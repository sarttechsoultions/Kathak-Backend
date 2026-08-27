import crypto from "crypto";
import { Request, Response } from "express";
import Razorpay from "razorpay";
import { DemoBookingStatus, DemoClassType, PaymentStatus } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { sendEmail } from "../../lib/mailer";
import {
  countedGroupBookings,
  COUNTED_DEMO_STATUSES,
  ensureDemoSettings,
  istDateTimeToUtc,
  serializeBooking,
  serializeSession,
  serializeSettings,
} from "../../lib/demo-classes";

const CLASS_MODES = new Set(["Online", "Offline", "Hybrid", "Other"]);
const BOOKING_STATUSES = new Set<DemoBookingStatus>([
  DemoBookingStatus.PENDING,
  DemoBookingStatus.CONFIRMED,
  DemoBookingStatus.CANCELLED,
  DemoBookingStatus.COMPLETED,
]);

class DemoError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function asString(value: unknown, max = 500): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return fallback;
}

function asPositiveNumber(value: unknown, fallback: number, max = 100000): number {
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw) || raw < 0) return fallback;
  return Math.min(max, Math.round(raw * 100) / 100);
}

function asPositiveInt(value: unknown, fallback: number, min = 1, max = 500): number {
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(raw) && !Number.isFinite(raw)) return fallback;
  const rounded = Math.round(raw);
  if (rounded < min || rounded > max) return fallback;
  return rounded;
}

function parseEmail(value: unknown): string {
  const email = asString(value, 180).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new DemoError("Please enter a valid email address.");
  }
  return email;
}

function parsePhone(value: unknown): string {
  const digits = asString(value, 40).replace(/\D/g, "");
  const normalized = digits.startsWith("91") && digits.length === 12 ? digits.slice(2) : digits;
  if (normalized.length !== 10) {
    throw new DemoError("Mobile number must be a valid 10-digit Indian number.");
  }
  return `+91 ${normalized}`;
}

function parseClassMode(value: unknown): string {
  const mode = asString(value, 40);
  if (!CLASS_MODES.has(mode)) {
    throw new DemoError("Please select a class mode.");
  }
  return mode;
}

function parseTime(value: unknown): string {
  const time = asString(value, 8);
  const match = time.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) {
    throw new DemoError("Please choose a valid time.");
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new DemoError("Please choose a valid time.");
  }
  return `${match[1]}:${match[2]}`;
}

function handleError(res: Response, error: unknown, fallback: string) {
  if (error instanceof DemoError) {
    res.status(error.statusCode).json({ status: "error", message: error.message });
    return;
  }
  console.error(fallback, error);
  res.status(500).json({ status: "error", message: fallback });
}

async function sendBookingEmail(booking: {
  fullName: string;
  email: string;
  type: DemoClassType;
  course: string;
  classMode: string;
  amount: number;
  preferredDate: Date | null;
  preferredTime: string | null;
  session: { title: string; startsAt: Date } | null;
}) {
  const isGroup = booking.type === DemoClassType.GROUP;
  const when = isGroup && booking.session
    ? booking.session.startsAt.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : booking.preferredDate
      ? `${booking.preferredDate.toLocaleDateString("en-IN", {
          timeZone: "Asia/Kolkata",
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })}${booking.preferredTime ? ` at ${booking.preferredTime}` : ""}`
      : "to be confirmed";

  await sendEmail({
    to: booking.email,
    subject: isGroup ? "Group demo class booked" : "One-to-one demo class request received",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <h2 style="color: #900C27;">Kathak by Harshita</h2>
        <p>Hi ${booking.fullName},</p>
        <p>Thank you for booking a ${isGroup ? "group" : "one-to-one"} demo class.</p>
        <div style="background-color: #f9f9f9; border-left: 4px solid #900C27; padding: 15px; margin: 20px 0;">
          <p style="margin: 0 0 8px;"><strong>Type:</strong> ${isGroup ? "Group (Free)" : "One-to-One (Paid)"}</p>
          <p style="margin: 0 0 8px;"><strong>Course:</strong> ${booking.course}</p>
          <p style="margin: 0 0 8px;"><strong>Class mode:</strong> ${booking.classMode}</p>
          <p style="margin: 0 0 8px;"><strong>When:</strong> ${when}</p>
          ${!isGroup ? `<p style="margin: 0;"><strong>Fee:</strong> ₹${booking.amount.toLocaleString("en-IN")}</p>` : ""}
        </div>
        <p>Our team will get in touch with you shortly with class details.</p>
        <p>Best regards,<br /><strong>Kathak Academy Team</strong></p>
      </div>
    `,
  });
}

function bookingInclude() {
  return {
    session: {
      select: {
        id: true,
        title: true,
        startsAt: true,
        durationMins: true,
        classMode: true,
      },
    },
  } as const;
}

export const getPublicDemo = async (_req: Request, res: Response): Promise<void> => {
  try {
    const settings = await ensureDemoSettings();
    const now = new Date();
    const sessions = await prisma.demoGroupSession.findMany({
      where: { isPublished: true, startsAt: { gte: now } },
      orderBy: { startsAt: "asc" },
      take: 50,
    });

    const counts = await Promise.all(sessions.map((session) => countedGroupBookings(session.id)));

    res.status(200).json({
      status: "success",
      data: {
        settings: serializeSettings(settings),
        sessions: sessions.map((session, index) => serializeSession(session, counts[index])),
      },
    });
  } catch (error) {
    handleError(res, error, "Failed to load demo classes.");
  }
};

export const createPublicDemoBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const settings = await ensureDemoSettings();
    const typeRaw = asString(req.body?.type, 20).toUpperCase().replace(/-/g, "_");
    const type = typeRaw === "GROUP" ? DemoClassType.GROUP : DemoClassType.ONE_TO_ONE;

    const fullName = asString(req.body?.fullName, 120);
    const email = parseEmail(req.body?.email);
    const phone = parsePhone(req.body?.phone);
    const course = asString(req.body?.course, 220);
    const classMode = parseClassMode(req.body?.classMode);
    const message = asString(req.body?.message, 4000);

    if (!fullName || fullName.length < 2) {
      throw new DemoError("Full name is required.");
    }
    if (!course) {
      throw new DemoError("Please select a course.");
    }

    if (type === DemoClassType.GROUP) {
      const sessionId = asString(req.body?.sessionId, 80);
      if (!sessionId) {
        throw new DemoError("Please select a group demo class.");
      }

      const session = await prisma.demoGroupSession.findUnique({ where: { id: sessionId } });
      if (!session || !session.isPublished) {
        throw new DemoError("That demo class is no longer available.", 404);
      }
      if (session.startsAt.getTime() < Date.now()) {
        throw new DemoError("That demo class has already started.");
      }

      const bookedCount = await countedGroupBookings(session.id);
      if (bookedCount >= session.capacity) {
        throw new DemoError("This group demo class is full. Please choose another date.");
      }

      const booking = await prisma.demoBooking.create({
        data: {
          type,
          status: DemoBookingStatus.CONFIRMED,
          fullName,
          email,
          phone,
          course,
          classMode,
          message,
          sessionId: session.id,
          amount: 0,
          paymentStatus: PaymentStatus.SUCCESS,
        },
        include: bookingInclude(),
      });

      void sendBookingEmail({
        fullName: booking.fullName,
        email: booking.email,
        type: booking.type,
        course: booking.course,
        classMode: booking.classMode,
        amount: booking.amount,
        preferredDate: booking.preferredDate,
        preferredTime: booking.preferredTime,
        session: booking.session,
      });

      res.status(201).json({
        status: "success",
        message: "Your group demo class is booked. We will share class details shortly.",
        data: { booking: serializeBooking(booking), needsPayment: false },
      });
      return;
    }

    if (!settings.isOneToOneEnabled) {
      throw new DemoError("One-to-one demo classes are currently unavailable.");
    }

    const preferredDateRaw = asString(req.body?.preferredDate, 20);
    const preferredTime = parseTime(req.body?.preferredTime);
    const preferredDate = istDateTimeToUtc(preferredDateRaw, preferredTime);
    if (!preferredDate) {
      throw new DemoError("Please choose a date and time for your one-to-one class.");
    }
    if (preferredDate.getTime() < Date.now() - 60_000) {
      throw new DemoError("Please choose a future date and time.");
    }

    const amount = Math.max(0, settings.oneToOneFeeINR);
    const isFree = amount <= 0;

    const booking = await prisma.demoBooking.create({
      data: {
        type,
        status: isFree ? DemoBookingStatus.CONFIRMED : DemoBookingStatus.PENDING,
        fullName,
        email,
        phone,
        course,
        classMode,
        message,
        preferredDate,
        preferredTime,
        amount,
        paymentStatus: isFree ? PaymentStatus.SUCCESS : PaymentStatus.PENDING,
      },
      include: bookingInclude(),
    });

    if (isFree) {
      void sendBookingEmail({
        fullName: booking.fullName,
        email: booking.email,
        type: booking.type,
        course: booking.course,
        classMode: booking.classMode,
        amount: booking.amount,
        preferredDate: booking.preferredDate,
        preferredTime: booking.preferredTime,
        session: booking.session,
      });

      res.status(201).json({
        status: "success",
        message: "Your one-to-one demo request is booked. We will confirm shortly.",
        data: { booking: serializeBooking(booking), needsPayment: false },
      });
      return;
    }

    if (!env.razorpayKeyId || !env.razorpayKeySecret) {
      await prisma.demoBooking.update({
        where: { id: booking.id },
        data: { paymentStatus: PaymentStatus.FAILED, status: DemoBookingStatus.CANCELLED },
      });
      throw new DemoError("Payment is temporarily unavailable. Please try again later.", 500);
    }

    const razorpay = new Razorpay({
      key_id: env.razorpayKeyId,
      key_secret: env.razorpayKeySecret,
    });

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: `demo_${booking.id.replace(/-/g, "").slice(0, 20)}`,
      notes: {
        demoBookingId: booking.id,
        type: "ONE_TO_ONE",
      },
    });

    await prisma.demoBooking.update({
      where: { id: booking.id },
      data: { razorpayOrderId: order.id },
    });

    res.status(201).json({
      status: "success",
      message: "Complete payment to confirm your one-to-one demo class.",
      data: {
        booking: serializeBooking(booking),
        needsPayment: true,
        order: {
          bookingId: booking.id,
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
          keyId: env.razorpayKeyId,
        },
      },
    });
  } catch (error) {
    handleError(res, error, "Failed to book demo class. Please try again.");
  }
};

async function markDemoPaid(
  bookingId: string,
  razorpayOrderId: string,
  razorpayPaymentId: string,
) {
  const existing = await prisma.demoBooking.findUnique({
    where: { id: bookingId },
    include: bookingInclude(),
  });
  if (!existing) {
    throw new DemoError("Booking not found.", 404);
  }
  if (existing.razorpayOrderId && existing.razorpayOrderId !== razorpayOrderId) {
    throw new DemoError("Payment order does not match this booking.");
  }
  if (existing.paymentStatus === PaymentStatus.SUCCESS) {
    return existing;
  }

  const updated = await prisma.demoBooking.update({
    where: { id: bookingId },
    data: {
      paymentStatus: PaymentStatus.SUCCESS,
      status: DemoBookingStatus.CONFIRMED,
      razorpayOrderId,
      razorpayPaymentId,
    },
    include: bookingInclude(),
  });

  void sendBookingEmail({
    fullName: updated.fullName,
    email: updated.email,
    type: updated.type,
    course: updated.course,
    classMode: updated.classMode,
    amount: updated.amount,
    preferredDate: updated.preferredDate,
    preferredTime: updated.preferredTime,
    session: updated.session,
  });

  return updated;
}

export const verifyPublicDemoPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const bookingId = asString(req.body?.bookingId, 80);
    const razorpayOrderId = asString(req.body?.razorpay_order_id, 80);
    const razorpayPaymentId = asString(req.body?.razorpay_payment_id, 80);
    const razorpaySignature = asString(req.body?.razorpay_signature, 200);

    if (!bookingId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      throw new DemoError("Payment verification failed. Please try again.");
    }
    if (!env.razorpayKeySecret) {
      throw new DemoError("Payment is temporarily unavailable. Please try again later.", 500);
    }

    const expected = crypto
      .createHmac("sha256", env.razorpayKeySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");

    if (expected !== razorpaySignature) {
      throw new DemoError("Payment verification failed. Invalid signature.");
    }

    const booking = await prisma.demoBooking.findFirst({
      where: { id: bookingId, razorpayOrderId },
    });
    if (!booking) {
      throw new DemoError("Booking order not found.", 404);
    }

    const confirmed = await markDemoPaid(booking.id, razorpayOrderId, razorpayPaymentId);
    res.status(200).json({
      status: "success",
      message: "Payment received. Your one-to-one demo class is confirmed.",
      data: { booking: serializeBooking(confirmed) },
    });
  } catch (error) {
    handleError(res, error, "Failed to verify payment.");
  }
};

export async function confirmDemoBookingByOrder(
  razorpayOrderId: string,
  razorpayPaymentId: string,
): Promise<boolean> {
  const booking = await prisma.demoBooking.findFirst({
    where: { razorpayOrderId },
    select: { id: true },
  });
  if (!booking) return false;
  await markDemoPaid(booking.id, razorpayOrderId, razorpayPaymentId);
  return true;
}

export async function failDemoBookingByOrder(razorpayOrderId: string): Promise<void> {
  await prisma.demoBooking.updateMany({
    where: { razorpayOrderId, paymentStatus: PaymentStatus.PENDING },
    data: { paymentStatus: PaymentStatus.FAILED, status: DemoBookingStatus.CANCELLED },
  });
}

export const getAdminDemoSettings = async (_req: Request, res: Response): Promise<void> => {
  try {
    const settings = await ensureDemoSettings();
    res.status(200).json({ status: "success", data: serializeSettings(settings) });
  } catch (error) {
    handleError(res, error, "Failed to load demo settings.");
  }
};

export const updateAdminDemoSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    await ensureDemoSettings();
    const updated = await prisma.demoSettings.update({
      where: { id: "default" },
      data: {
        oneToOneFeeINR:
          req.body?.oneToOneFeeINR !== undefined
            ? asPositiveNumber(req.body.oneToOneFeeINR, 499)
            : undefined,
        oneToOneDurationMins:
          req.body?.oneToOneDurationMins !== undefined
            ? asPositiveInt(req.body.oneToOneDurationMins, 45, 15, 240)
            : undefined,
        isOneToOneEnabled:
          req.body?.isOneToOneEnabled !== undefined
            ? asBoolean(req.body.isOneToOneEnabled, true)
            : undefined,
        isGroupEnabled:
          req.body?.isGroupEnabled !== undefined ? asBoolean(req.body.isGroupEnabled, true) : undefined,
      },
    });
    res.status(200).json({ status: "success", data: serializeSettings(updated) });
  } catch (error) {
    handleError(res, error, "Failed to update demo settings.");
  }
};

export const getAdminDemoSessions = async (_req: Request, res: Response): Promise<void> => {
  try {
    const sessions = await prisma.demoGroupSession.findMany({
      orderBy: { startsAt: "desc" },
    });
    const counts = await Promise.all(sessions.map((session) => countedGroupBookings(session.id)));
    res.status(200).json({
      status: "success",
      data: { sessions: sessions.map((session, index) => serializeSession(session, counts[index])) },
    });
  } catch (error) {
    handleError(res, error, "Failed to load demo sessions.");
  }
};

function parseSessionBody(body: Record<string, unknown>, partial = false) {
  const title = asString(body.title, 180);
  const date = asString(body.date, 20);
  const time = asString(body.time, 8);
  const classMode = asString(body.classMode, 40) || "Online";
  const location = body.location !== undefined ? asString(body.location, 300) : undefined;
  const notes = body.notes !== undefined ? asString(body.notes, 2000) : undefined;

  if (!partial && !title) {
    throw new DemoError("Session title is required.");
  }

  let startsAt: Date | undefined;
  if (date || time) {
    if (!date || !time) {
      throw new DemoError("Date and time are both required.");
    }
    const parsed = istDateTimeToUtc(date, parseTime(time));
    if (!parsed) throw new DemoError("Please enter a valid date and time.");
    startsAt = parsed;
  } else if (!partial) {
    throw new DemoError("Date and time are required.");
  }

  return {
    title: title || undefined,
    startsAt,
    durationMins: body.durationMins !== undefined ? asPositiveInt(body.durationMins, 60, 15, 240) : undefined,
    classMode: CLASS_MODES.has(classMode) ? classMode : undefined,
    capacity: body.capacity !== undefined ? asPositiveInt(body.capacity, 20, 1, 200) : undefined,
    location,
    notes,
    isPublished: body.isPublished !== undefined ? asBoolean(body.isPublished, true) : undefined,
  };
}

export const createAdminDemoSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = parseSessionBody(req.body || {}, false);
    const created = await prisma.demoGroupSession.create({
      data: {
        title: parsed.title!,
        startsAt: parsed.startsAt!,
        durationMins: parsed.durationMins ?? 60,
        classMode: parsed.classMode || "Online",
        capacity: parsed.capacity ?? 20,
        location: parsed.location ?? "",
        notes: parsed.notes ?? "",
        isPublished: parsed.isPublished ?? true,
      },
    });
    res.status(201).json({
      status: "success",
      message: "Group demo class created.",
      data: serializeSession(created, 0),
    });
  } catch (error) {
    handleError(res, error, "Failed to create demo session.");
  }
};

export const updateAdminDemoSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = asString(req.params.id, 80);
    const existing = await prisma.demoGroupSession.findUnique({ where: { id } });
    if (!existing) {
      throw new DemoError("Demo session not found.", 404);
    }
    const parsed = parseSessionBody(req.body || {}, true);
    const updated = await prisma.demoGroupSession.update({
      where: { id },
      data: {
        title: parsed.title,
        startsAt: parsed.startsAt,
        durationMins: parsed.durationMins,
        classMode: parsed.classMode,
        capacity: parsed.capacity,
        location: parsed.location,
        notes: parsed.notes,
        isPublished: parsed.isPublished,
      },
    });
    const bookedCount = await countedGroupBookings(updated.id);
    res.status(200).json({ status: "success", data: serializeSession(updated, bookedCount) });
  } catch (error) {
    handleError(res, error, "Failed to update demo session.");
  }
};

export const deleteAdminDemoSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = asString(req.params.id, 80);
    await prisma.demoGroupSession.delete({ where: { id } });
    res.status(200).json({ status: "success", message: "Demo session deleted." });
  } catch (error) {
    handleError(res, error, "Failed to delete demo session.");
  }
};

export const getAdminDemoBookings = async (_req: Request, res: Response): Promise<void> => {
  try {
    const bookings = await prisma.demoBooking.findMany({
      include: bookingInclude(),
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const pending = bookings.filter(
      (item) => item.status === DemoBookingStatus.PENDING || item.status === DemoBookingStatus.CONFIRMED,
    ).length;
    res.status(200).json({
      status: "success",
      data: {
        bookings: bookings.map(serializeBooking),
        stats: {
          total: bookings.length,
          pending,
          oneToOne: bookings.filter((item) => item.type === DemoClassType.ONE_TO_ONE).length,
          group: bookings.filter((item) => item.type === DemoClassType.GROUP).length,
        },
      },
    });
  } catch (error) {
    handleError(res, error, "Failed to load demo bookings.");
  }
};

export const updateAdminDemoBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = asString(req.params.id, 80);
    const statusRaw = asString(req.body?.status, 20).toUpperCase() as DemoBookingStatus;
    if (!BOOKING_STATUSES.has(statusRaw)) {
      throw new DemoError("Invalid booking status.");
    }
    const updated = await prisma.demoBooking.update({
      where: { id },
      data: { status: statusRaw },
      include: bookingInclude(),
    });
    res.status(200).json({ status: "success", data: serializeBooking(updated) });
  } catch (error) {
    handleError(res, error, "Failed to update booking.");
  }
};

export const replyAdminDemoBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = asString(req.params.id, 80);
    const message = asString(req.body?.message, 4000);
    if (!message) {
      throw new DemoError("Reply message is required.");
    }
    const booking = await prisma.demoBooking.update({
      where: { id },
      data: { status: DemoBookingStatus.CONFIRMED },
      include: bookingInclude(),
    });

    const emailSent = await sendEmail({
      to: booking.email,
      subject: "Your Kathak demo class",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <h2 style="color: #900C27;">Kathak by Harshita</h2>
          <p>Hi ${booking.fullName},</p>
          <p>Here is an update about your demo class request.</p>
          <div style="background-color: #f9f9f9; border-left: 4px solid #900C27; padding: 15px; margin: 20px 0;">
            <p style="white-space: pre-wrap; margin: 0;">${message}</p>
          </div>
          <p>Best regards,<br /><strong>Kathak Academy Team</strong></p>
        </div>
      `,
    });

    res.status(200).json({
      status: "success",
      message: emailSent ? "Reply sent." : "Status updated, but the email could not be sent.",
      data: serializeBooking(booking),
    });
  } catch (error) {
    handleError(res, error, "Failed to send reply.");
  }
};

export const deleteAdminDemoBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = asString(req.params.id, 80);
    await prisma.demoBooking.delete({ where: { id } });
    res.status(200).json({ status: "success", message: "Booking deleted." });
  } catch (error) {
    handleError(res, error, "Failed to delete booking.");
  }
};
