type LiveClassLike = {
  id: string;
  title: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  status: string;
  teacherName?: string | null;
  batch?: { name?: string | null; courseName?: string | null } | null;
};

export type LiveClassReminder = {
  title: string;
  subtitle: string;
  kind: "live_class";
  href: string;
  scheduledStart: string;
};

type NotificationPrefs = {
  liveClassReminders: boolean;
};

export const parseLiveClassReminderPrefs = (raw: unknown): NotificationPrefs => {
  if (!raw) return { liveClassReminders: true };

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { liveClassReminders: true };
    }
  }

  if (typeof parsed === "object" && parsed !== null) {
    const prefs = parsed as Record<string, unknown>;
    return { liveClassReminders: prefs.liveClassReminders !== false };
  }

  return { liveClassReminders: true };
};

const istDateKey = (date: Date): string =>
  date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export const formatLiveClassReminderSubtitle = (scheduledStart: Date): string => {
  const now = new Date();
  const diffMs = scheduledStart.getTime() - now.getTime();
  const diffMins = Math.round(diffMs / 60000);

  const timeStr = scheduledStart.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });

  const todayKey = istDateKey(now);
  const classDayKey = istDateKey(scheduledStart);
  const tomorrowKey = istDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  if (diffMins >= 0 && diffMins <= 15) {
    return diffMins <= 1 ? `Starting now · ${timeStr}` : `Starting in ${diffMins} min · ${timeStr}`;
  }

  if (classDayKey === todayKey) {
    if (diffMins > 0 && diffMins <= 60) {
      return `Starting in ${diffMins} min · Today at ${timeStr}`;
    }
    return `Today at ${timeStr}`;
  }

  if (classDayKey === tomorrowKey) {
    return `Tomorrow at ${timeStr}`;
  }

  const dateStr = scheduledStart.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
  return `${dateStr} at ${timeStr}`;
};

export const buildLiveClassReminders = (
  classes: LiveClassLike[],
  opts?: { max?: number; daysAhead?: number; enabled?: boolean }
): LiveClassReminder[] => {
  if (opts?.enabled === false) return [];

  const max = opts?.max ?? 5;
  const daysAhead = opts?.daysAhead ?? 14;
  const now = new Date();
  const cutoff = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  return classes
    .filter(
      (lc) =>
        (lc.status === "SCHEDULED" || lc.status === "LIVE") &&
        new Date(lc.scheduledEnd).getTime() > now.getTime() &&
        new Date(lc.scheduledStart).getTime() <= cutoff.getTime()
    )
    .sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime())
    .slice(0, max)
    .map((lc) => ({
      title: lc.title || lc.batch?.name || "Live Class",
      subtitle: formatLiveClassReminderSubtitle(new Date(lc.scheduledStart)),
      kind: "live_class" as const,
      href: lc.status === "LIVE" ? `/student/classes/room/${lc.id}` : "/student/classes",
      scheduledStart: new Date(lc.scheduledStart).toISOString(),
    }));
};
