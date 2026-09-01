export const TEACHER_EARLY_JOIN_MINUTES = 10;

type TimedClass = {
  scheduledStart: Date | string;
  scheduledEnd: Date | string;
  status: string;
};

export const getTeacherJoinWindowStart = (scheduledStart: Date | string): Date => {
  const start = new Date(scheduledStart);
  return new Date(start.getTime() - TEACHER_EARLY_JOIN_MINUTES * 60 * 1000);
};

/** All active scheduled/live classes are visible in the teacher list. */
export const isTeacherUpcomingVisible = (cls: TimedClass, now = new Date()): boolean => {
  if (cls.status === "CANCELLED" || cls.status === "COMPLETED") return false;
  const end = new Date(cls.scheduledEnd);
  if (now > end) return false;
  return cls.status === "SCHEDULED" || cls.status === "LIVE";
};

export const canTeacherJoinClass = (cls: TimedClass, now = new Date()): boolean => {
  if (cls.status === "CANCELLED" || cls.status === "COMPLETED") return false;
  const end = new Date(cls.scheduledEnd);
  if (now > end) return false;
  if (cls.status === "LIVE") return true;
  if (cls.status !== "SCHEDULED") return false;
  return now >= getTeacherJoinWindowStart(cls.scheduledStart);
};

export const minutesUntilTeacherCanJoin = (cls: TimedClass, now = new Date()): number => {
  if (canTeacherJoinClass(cls, now)) return 0;
  if (cls.status !== "SCHEDULED") return -1;
  if (now > new Date(cls.scheduledEnd)) return -1;
  const joinAt = getTeacherJoinWindowStart(cls.scheduledStart);
  if (now >= joinAt) return 0;
  return Math.max(0, Math.ceil((joinAt.getTime() - now.getTime()) / 60000));
};

export const hasClassStartTimePassed = (scheduledStart: Date | string, now = new Date()): boolean =>
  now >= new Date(scheduledStart);
