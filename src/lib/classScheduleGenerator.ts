const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const DAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type ParsedBatchSchedule = {
  days: string[];
  time: string;
  startDate: string;
  endDate: string;
};

export type ClassSlot = {
  scheduledStart: Date;
  scheduledEnd: Date;
};

export const parseBatchSchedule = (rawSchedule?: string | null): ParsedBatchSchedule => {
  const empty: ParsedBatchSchedule = { days: [], time: "", startDate: "", endDate: "" };
  if (!rawSchedule || rawSchedule === "Not Scheduled") return empty;

  if (rawSchedule.includes("|")) {
    const parts = rawSchedule.split("|");
    return {
      days: (parts[0] || "")
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean),
      time: (parts[1] || "").trim(),
      startDate: (parts[2] || "").trim(),
      endDate: (parts[3] || "").trim(),
    };
  }

  const timeMatch = rawSchedule.match(/\((.*?)\)/);
  const time = timeMatch?.[1]?.trim() || "";
  const daysPart = rawSchedule.replace(/\(.*?\)/, "").trim();
  const days = daysPart
    .split(/[, ]+/)
    .map((d) => d.trim())
    .filter((d) => DAY_NAMES.includes(d as (typeof DAY_NAMES)[number]));

  return { days, time, startDate: "", endDate: "" };
};

export const parseScheduleTime = (timeStr: string): { hours: number; minutes: number } => {
  const trimmed = String(timeStr || "").trim();
  const match12 = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = parseInt(match12[2], 10);
    const ampm = match12[3].toUpperCase();
    if (ampm === "PM" && hours !== 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;
    return { hours, minutes };
  }

  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    return { hours: parseInt(match24[1], 10), minutes: parseInt(match24[2], 10) };
  }

  return { hours: 18, minutes: 30 };
};

/** Build a Date in IST regardless of server timezone. */
export const buildISTDate = (
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number
): Date => {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const hh = String(hours).padStart(2, "0");
  const min = String(minutes).padStart(2, "0");
  return new Date(`${year}-${mm}-${dd}T${hh}:${min}:00+05:30`);
};

const getISTDayIndex = (date: Date): number => {
  const short = date.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "Asia/Kolkata",
  });
  return DAY_INDEX[short] ?? date.getDay();
};

const parseIsoDateOnly = (value: string): Date | null => {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return buildISTDate(parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10), 0, 0);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const generateMonthlyClassSlots = (options: {
  scheduleRaw: string;
  year: number;
  month: number;
  durationMinutes?: number;
  skipPast?: boolean;
}): ClassSlot[] => {
  const { scheduleRaw, year, month, durationMinutes = 60, skipPast = true } = options;
  const parsed = parseBatchSchedule(scheduleRaw);

  if (parsed.days.length === 0 || !parsed.time) {
    return [];
  }

  const dayIndexes = new Set(
    parsed.days
      .map((d) => DAY_INDEX[d])
      .filter((idx): idx is number => typeof idx === "number")
  );
  if (dayIndexes.size === 0) return [];

  const { hours, minutes } = parseScheduleTime(parsed.time);
  const monthStart = buildISTDate(year, month, 1, 0, 0);
  const lastDay = new Date(year, month, 0).getDate();

  const rangeStart = parseIsoDateOnly(parsed.startDate);
  const rangeEnd = parseIsoDateOnly(parsed.endDate);
  const now = new Date();

  const slots: ClassSlot[] = [];

  for (let day = 1; day <= lastDay; day += 1) {
    const slotStart = buildISTDate(year, month, day, hours, minutes);
    const dayOfWeek = getISTDayIndex(slotStart);

    if (!dayIndexes.has(dayOfWeek)) continue;
    if (rangeStart && slotStart < rangeStart) continue;
    if (rangeEnd) {
      const endOfDay = buildISTDate(year, month, day, 23, 59);
      if (endOfDay > rangeEnd && slotStart > rangeEnd) continue;
    }
    if (skipPast && slotStart.getTime() <= now.getTime()) continue;

    const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000);
    slots.push({ scheduledStart: slotStart, scheduledEnd: slotEnd });
  }

  return slots.sort((a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime());
};

export const formatMonthYearLabel = (year: number, month: number): string => {
  return buildISTDate(year, month, 1, 12, 0).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
};

export const formatClassSlotTitle = (
  batchName: string,
  courseName: string | null | undefined,
  slotStart: Date
): string => {
  const dateLabel = slotStart.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
  const prefix = courseName ? `${courseName} — ${batchName}` : batchName;
  return `${prefix} (${dateLabel})`;
};
