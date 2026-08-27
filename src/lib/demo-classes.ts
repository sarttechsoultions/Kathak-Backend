import { DemoBookingStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "./prisma";

export const DEMO_SETTINGS_ID = "default";

export const DEMO_SETTINGS_DEFAULTS = {
  id: DEMO_SETTINGS_ID,
  oneToOneFeeINR: 499,
  oneToOneDurationMins: 45,
  isOneToOneEnabled: true,
  isGroupEnabled: true,
};

export async function ensureDemoSettings() {
  const existing = await prisma.demoSettings.findUnique({
    where: { id: DEMO_SETTINGS_ID },
  });
  if (existing) return existing;
  return prisma.demoSettings.create({ data: DEMO_SETTINGS_DEFAULTS });
}

export function formatIstDateTime(date: Date) {
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatIstDate(date: Date) {
  return date.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatIstTime(date: Date) {
  return date.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Combine an IST calendar date + HH:mm into a UTC Date. */
export function istDateTimeToUtc(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const match = time.match(/^(\d{2}):(\d{2})/);
  if (!match) return null;
  const parsed = new Date(`${date}T${match[1]}:${match[2]}:00+05:30`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function serializeSettings(item: {
  id: string;
  oneToOneFeeINR: number;
  oneToOneDurationMins: number;
  isOneToOneEnabled: boolean;
  isGroupEnabled: boolean;
  updatedAt: Date;
}) {
  return {
    id: item.id,
    oneToOneFeeINR: item.oneToOneFeeINR,
    oneToOneDurationMins: item.oneToOneDurationMins,
    isOneToOneEnabled: item.isOneToOneEnabled,
    isGroupEnabled: item.isGroupEnabled,
    updatedAt: item.updatedAt,
  };
}

export function serializeSession(
  session: {
    id: string;
    title: string;
    startsAt: Date;
    durationMins: number;
    classMode: string;
    capacity: number;
    location: string;
    notes: string;
    isPublished: boolean;
    createdAt: Date;
    updatedAt: Date;
  },
  bookedCount = 0,
) {
  const seatsLeft = Math.max(session.capacity - bookedCount, 0);
  return {
    id: session.id,
    title: session.title,
    startsAt: session.startsAt.toISOString(),
    dateLabel: formatIstDate(session.startsAt),
    timeLabel: formatIstTime(session.startsAt),
    dateTimeLabel: formatIstDateTime(session.startsAt),
    durationMins: session.durationMins,
    classMode: session.classMode,
    capacity: session.capacity,
    bookedCount,
    seatsLeft,
    location: session.location,
    notes: session.notes,
    isPublished: session.isPublished,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

export function serializeBooking(booking: {
  id: string;
  type: string;
  status: string;
  fullName: string;
  email: string;
  phone: string;
  course: string;
  classMode: string;
  message: string;
  preferredDate: Date | null;
  preferredTime: string | null;
  sessionId: string | null;
  amount: number;
  paymentStatus: string;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  session?: {
    id: string;
    title: string;
    startsAt: Date;
    durationMins: number;
    classMode: string;
  } | null;
}) {
  return {
    id: booking.id,
    type: booking.type,
    status: booking.status,
    fullName: booking.fullName,
    email: booking.email,
    phone: booking.phone,
    course: booking.course,
    classMode: booking.classMode,
    message: booking.message,
    preferredDate: booking.preferredDate ? booking.preferredDate.toISOString() : null,
    preferredTime: booking.preferredTime,
    preferredDateLabel: booking.preferredDate ? formatIstDate(booking.preferredDate) : null,
    sessionId: booking.sessionId,
    sessionTitle: booking.session?.title || null,
    sessionDateLabel: booking.session ? formatIstDateTime(booking.session.startsAt) : null,
    amount: booking.amount,
    paymentStatus: booking.paymentStatus,
    createdAt: booking.createdAt.toISOString(),
    updatedAt: booking.updatedAt.toISOString(),
  };
}

export const COUNTED_DEMO_STATUSES: DemoBookingStatus[] = [
  DemoBookingStatus.PENDING,
  DemoBookingStatus.CONFIRMED,
];

export async function countedGroupBookings(sessionId: string) {
  return prisma.demoBooking.count({
    where: {
      sessionId,
      type: "GROUP",
      status: { in: COUNTED_DEMO_STATUSES },
      paymentStatus: { not: PaymentStatus.FAILED },
    },
  });
}
