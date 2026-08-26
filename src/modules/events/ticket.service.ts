import crypto from "crypto";
import Razorpay from "razorpay";
import { EventCategory, EventStatus, PaymentStatus } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { sendEventTicketEmail, ticketQrUrl } from "../../lib/ticket-email";

const VISIBLE_STATUSES: EventStatus[] = [EventStatus.SCHEDULED, EventStatus.LIVE];
const COUNTED_PAYMENT_STATUSES: PaymentStatus[] = [PaymentStatus.PENDING, PaymentStatus.SUCCESS];

export type TicketConfirmation = {
  bookingId: string;
  eventId: string;
  eventTitle: string;
  category: EventCategory;
  dateTime: string;
  dateLabel: string;
  timeLabel: string;
  venue: string;
  attendeeName: string;
  email: string;
  ticketEmail: string;
  phone: string;
  city: string;
  adultCount: number;
  childCount: number;
  quantity: number;
  ticketBreakdown: string;
  amount: number;
  amountLabel: string;
  paymentMethod: string;
  paymentStatus: PaymentStatus;
  qrImage: string;
  emailSent: boolean;
};

export class TicketError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseCount(value: unknown, field: string, fallback = 0): number {
  if (value === undefined || value === null || value === "") return fallback;
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(count) || count < 0 || count > 20) {
    throw new TicketError(`${field} must be a whole number between 0 and 20.`);
  }
  return count;
}

function parseEmail(value: unknown, field: string): string {
  const email = asString(value).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new TicketError(`${field} must be a valid email address.`);
  }
  return email;
}

function parsePhone(value: unknown): string {
  const digits = asString(value).replace(/\D/g, "");
  const normalized = digits.startsWith("91") && digits.length === 12 ? digits.slice(2) : digits;
  if (normalized.length !== 10) {
    throw new TicketError("Phone number must be a valid 10-digit Indian mobile number.");
  }
  return `+91 ${normalized}`;
}

function createBookingId(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `KB-${stamp}${rand}`;
}

export function formatPrice(fee: number): string {
  return fee > 0 ? `₹${fee.toLocaleString("en-IN")}` : "Free";
}

export function formatDateRange(startDate: Date, endDate: Date): string {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const sameDay =
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCDate() === end.getUTCDate();

  const long: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" };
  const short: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };

  if (sameDay) return start.toLocaleDateString("en-US", long);
  return `${start.toLocaleDateString("en-US", short)} - ${end.toLocaleDateString("en-US", long)}`;
}

export function formatTimeRange(startTime: string, durationMins: number): string {
  const [hours, minutes] = (startTime || "00:00").split(":").map(Number);
  const start = new Date(Date.UTC(2000, 0, 1, hours || 0, minutes || 0, 0));
  const end = new Date(start.getTime() + Math.max(durationMins, 0) * 60_000);
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" };
  return `${start.toLocaleTimeString("en-US", opts)} - ${end.toLocaleTimeString("en-US", opts)}`;
}

export function formatTicketBreakdown(adultCount: number, childCount: number): string {
  const parts: string[] = [];
  if (adultCount > 0) parts.push(`${String(adultCount).padStart(2, "0")} Adult`);
  if (childCount > 0) parts.push(`${String(childCount).padStart(2, "0")} Child`);
  return parts.join(", ") || "No seats";
}

export async function bookedSeats(eventId: string): Promise<number> {
  const [registrations, tickets] = await Promise.all([
    prisma.eventRegistration.count({ where: { eventId } }),
    prisma.eventTicket.aggregate({
      where: { eventId, paymentStatus: { in: COUNTED_PAYMENT_STATUSES } },
      _sum: { quantity: true },
    }),
  ]);
  return registrations + (tickets._sum.quantity ?? 0);
}

function ticketCounts(ticket: { adultCount: number; childCount: number; quantity: number }) {
  const adultCount = ticket.adultCount || (ticket.childCount > 0 ? 0 : ticket.quantity);
  const childCount = ticket.childCount || 0;
  const quantity = Math.max(ticket.quantity, adultCount + childCount);
  return { adultCount, childCount, quantity };
}

async function serializeTicket(
  ticket: {
    bookingId: string;
    eventId: string;
    fullName: string;
    email: string;
    ticketEmail: string;
    phone: string;
    city: string;
    adultCount: number;
    childCount: number;
    quantity: number;
    amount: number;
    paymentMethod: string | null;
    paymentStatus: PaymentStatus;
  },
  event: {
    title: string;
    category: EventCategory;
    startDate: Date;
    endDate: Date;
    startTime: string;
    durationMins: number;
    locationOrLink: string;
  },
  emailSent: boolean,
): Promise<TicketConfirmation> {
  const counts = ticketCounts(ticket);
  const dateLabel = formatDateRange(event.startDate, event.endDate);
  const timeLabel = formatTimeRange(event.startTime, event.durationMins);

  return {
    bookingId: ticket.bookingId,
    eventId: ticket.eventId,
    eventTitle: event.title,
    category: event.category,
    dateTime: `${dateLabel} • ${timeLabel}`,
    dateLabel,
    timeLabel,
    venue: event.locationOrLink,
    attendeeName: ticket.fullName,
    email: ticket.email,
    ticketEmail: ticket.ticketEmail,
    phone: ticket.phone,
    city: ticket.city,
    adultCount: counts.adultCount,
    childCount: counts.childCount,
    quantity: counts.quantity,
    ticketBreakdown: formatTicketBreakdown(counts.adultCount, counts.childCount),
    amount: ticket.amount,
    amountLabel: formatPrice(ticket.amount),
    paymentMethod: ticket.paymentMethod || "razorpay",
    paymentStatus: ticket.paymentStatus,
    qrImage: ticketQrUrl(ticket.bookingId),
    emailSent,
  };
}

async function sendPaidTicketEmail(
  ticket: {
    bookingId: string;
    fullName: string;
    ticketEmail: string;
    phone: string;
    adultCount: number;
    childCount: number;
    quantity: number;
    amount: number;
  },
  event: {
    title: string;
    category: EventCategory;
    startDate: Date;
    endDate: Date;
    startTime: string;
    durationMins: number;
    locationOrLink: string;
  },
): Promise<boolean> {
  const counts = ticketCounts(ticket);
  return sendEventTicketEmail({
    bookingId: ticket.bookingId,
    eventTitle: event.title,
    eventCategory: event.category,
    dateLabel: formatDateRange(event.startDate, event.endDate),
    timeLabel: formatTimeRange(event.startTime, event.durationMins),
    venue: event.locationOrLink,
    attendeeName: ticket.fullName,
    email: ticket.ticketEmail,
    phone: ticket.phone,
    quantity: counts.quantity,
    ticketBreakdown: formatTicketBreakdown(counts.adultCount, counts.childCount),
    amountLabel: formatPrice(ticket.amount),
  });
}

export async function createEventTicketOrder(eventId: string, body: Record<string, unknown>): Promise<
  | { needsPayment: false; confirmation: TicketConfirmation }
  | { needsPayment: true; order: { ticketId: string; bookingId: string; orderId: string; amount: number | string; currency: string; keyId: string; sendTicketEmail: boolean } }
> {
  const fullName = asString(body.fullName);
  const city = asString(body.city);
  const email = parseEmail(body.email, "Email");
  const ticketEmail = asString(body.ticketEmail) ? parseEmail(body.ticketEmail, "Ticket email") : email;
  const phone = parsePhone(body.phone);
  const paymentMethod = asString(body.paymentMethod) || "upi";
  const sendTicket = body.sendTicketEmail !== false;

  let adultCount = parseCount(body.adultCount, "Adult tickets");
  let childCount = parseCount(body.childCount, "Child tickets");

  if (adultCount + childCount === 0) {
    adultCount = parseCount(body.quantity, "Quantity", 1);
    if (adultCount < 1) {
      throw new TicketError("Select at least one adult or child ticket.");
    }
  }

  const quantity = adultCount + childCount;
  if (quantity < 1 || quantity > 20) {
    throw new TicketError("Total tickets must be between 1 and 20.");
  }

  if (fullName.length < 2) {
    throw new TicketError("Full name is required.");
  }

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event || event.status === EventStatus.DRAFT || event.status === EventStatus.CANCELLED) {
    throw new TicketError("Event not found.", 404);
  }

  if (!VISIBLE_STATUSES.includes(event.status)) {
    throw new TicketError("This event is not open for registration.");
  }

  const seatsTaken = await bookedSeats(event.id);
  const seatsLeft = Math.max(event.capacity - seatsTaken, 0);
  if (quantity > seatsLeft) {
    throw new TicketError(
      seatsLeft === 0 ? "This event is fully booked." : `Only ${seatsLeft} seat${seatsLeft === 1 ? "" : "s"} left.`,
    );
  }

  const amount = event.registrationFee * quantity;
  const bookingId = createBookingId();
  const isFree = amount <= 0;

  const ticket = await prisma.eventTicket.create({
    data: {
      bookingId,
      eventId: event.id,
      fullName,
      email,
      phone,
      city,
      adultCount,
      childCount,
      quantity,
      amount,
      paymentMethod: isFree ? "free" : paymentMethod,
      paymentStatus: isFree ? PaymentStatus.SUCCESS : PaymentStatus.PENDING,
      ticketEmail,
    },
  });

  if (isFree) {
    const emailSent = sendTicket ? await sendPaidTicketEmail(ticket, event) : false;
    return {
      needsPayment: false,
      confirmation: await serializeTicket(ticket, event, emailSent),
    };
  }

  if (!env.razorpayKeyId || !env.razorpayKeySecret) {
    await prisma.eventTicket.update({
      where: { id: ticket.id },
      data: { paymentStatus: PaymentStatus.FAILED },
    });
    throw new TicketError("Payment is temporarily unavailable. Please try again later.", 500);
  }

  const razorpay = new Razorpay({
    key_id: env.razorpayKeyId,
    key_secret: env.razorpayKeySecret,
  });

  const order = await razorpay.orders.create({
    amount: Math.round(amount * 100),
    currency: "INR",
    receipt: `tkt_${ticket.id.replace(/-/g, "").slice(0, 20)}`,
    notes: {
      eventTicketId: ticket.id,
      eventId: event.id,
      bookingId: ticket.bookingId,
    },
  });

  await prisma.eventTicket.update({
    where: { id: ticket.id },
    data: { razorpayOrderId: order.id },
  });

  return {
    needsPayment: true,
    order: {
      ticketId: ticket.id,
      bookingId: ticket.bookingId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: env.razorpayKeyId,
      sendTicketEmail: sendTicket,
    },
  };
}

async function markTicketPaid(
  ticketId: string,
  razorpayOrderId: string,
  razorpayPaymentId: string,
  sendTicket = true,
): Promise<TicketConfirmation> {
  const existing = await prisma.eventTicket.findUnique({
    where: { id: ticketId },
    include: { event: true },
  });

  if (!existing) {
    throw new TicketError("Ticket not found.", 404);
  }

  if (existing.razorpayOrderId && existing.razorpayOrderId !== razorpayOrderId) {
    throw new TicketError("Payment order does not match this ticket.");
  }

  if (existing.paymentStatus === PaymentStatus.SUCCESS) {
    return serializeTicket(existing, existing.event, true);
  }

  const ticket = await prisma.eventTicket.update({
    where: { id: ticketId },
    data: {
      paymentStatus: PaymentStatus.SUCCESS,
      razorpayOrderId,
      razorpayPaymentId,
      paymentMethod: existing.paymentMethod || "razorpay",
    },
    include: { event: true },
  });

  const emailSent = sendTicket ? await sendPaidTicketEmail(ticket, ticket.event) : false;
  return serializeTicket(ticket, ticket.event, emailSent);
}

export async function verifyEventTicketPayment(eventId: string, body: Record<string, unknown>) {
  const ticketId = asString(body.ticketId);
  const razorpayOrderId = asString(body.razorpay_order_id);
  const razorpayPaymentId = asString(body.razorpay_payment_id);
  const razorpaySignature = asString(body.razorpay_signature);
  const sendTicket = body.sendTicketEmail !== false;

  if (!ticketId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    throw new TicketError("Payment verification failed. Please try again.");
  }

  if (!env.razorpayKeySecret) {
    throw new TicketError("Payment is temporarily unavailable. Please try again later.", 500);
  }

  const expected = crypto
    .createHmac("sha256", env.razorpayKeySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  if (expected !== razorpaySignature) {
    throw new TicketError("Payment verification failed. Invalid signature.");
  }

  const ticket = await prisma.eventTicket.findFirst({
    where: {
      id: ticketId,
      eventId,
      razorpayOrderId,
    },
  });

  if (!ticket) {
    throw new TicketError("Ticket order not found.", 404);
  }

  return markTicketPaid(ticket.id, razorpayOrderId, razorpayPaymentId, sendTicket);
}

export async function confirmEventTicketByOrder(
  razorpayOrderId: string,
  razorpayPaymentId: string,
): Promise<boolean> {
  const ticket = await prisma.eventTicket.findFirst({
    where: { razorpayOrderId },
    select: { id: true },
  });

  if (!ticket) return false;

  await markTicketPaid(ticket.id, razorpayOrderId, razorpayPaymentId, true);
  return true;
}

export async function failEventTicketByOrder(razorpayOrderId: string): Promise<void> {
  await prisma.eventTicket.updateMany({
    where: { razorpayOrderId, paymentStatus: PaymentStatus.PENDING },
    data: { paymentStatus: PaymentStatus.FAILED },
  });
}
