import { prisma } from "../../lib/prisma";
import { resolveCurrency } from "../../lib/currency";

export type AccessState =
  | "ACTIVE"
  | "GRACE_PERIOD"
  | "TEMPORARILY_UNLOCKED"
  | "LOCKED";

export interface ActiveUnlockInfo {
  id: string;
  durationLabel: string;
  unlockedAt: Date;
  unlockUntil: Date;
  reason: string;
  unlockedByAdminId: string;
}

export interface StudentAccessStateResult {
  accessState: AccessState;
  isLocked: boolean;
  isTemporarilyUnlocked: boolean;
  amountDue: number;
  currency: "INR" | "USD";
  dueMonth: string | null;
  dueDate: Date | null;
  unlockUntil: Date | null;
  daysOverdue: number;
  activeUnlock: ActiveUnlockInfo | null;
  enrollmentId: string | null;
  courseId: string | null;
  courseTitle: string | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Authoritative Backend Access State Calculation Engine.
 *
 * Rules:
 * 1. No active enrollment -> LOCKED
 * 2. now < nextDueDate -> ACTIVE
 * 3. nextDueDate <= now < nextDueDate + 4 days (Day 0 through end of Day 3) -> GRACE_PERIOD
 * 4. now >= nextDueDate + 4 days (Day 4 onward) -> LOCKED
 * 5. Active admin unlock (now < unlockUntil & revokedAt === null) overrides GRACE_PERIOD & LOCKED -> TEMPORARILY_UNLOCKED
 */
export async function getStudentAccessState(
  studentId: string,
  nowOverride?: Date
): Promise<StudentAccessStateResult> {
  const now = nowOverride || new Date();

  // 1. Fetch student's active enrollment
  const student = await prisma.user.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      country: true,
      enrollments: {
        where: { active: true },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          course: true,
        },
      },
      accessUnlocksReceived: {
        where: {
          unlockUntil: { gt: now },
          revokedAt: null,
        },
        orderBy: { unlockUntil: "desc" },
        take: 1,
      },
    },
  });

  const currency = resolveCurrency(student?.country);
  const activeEnrollment = student?.enrollments?.[0] || null;
  const activeUnlockRaw = student?.accessUnlocksReceived?.[0] || null;

  const activeUnlock: ActiveUnlockInfo | null = activeUnlockRaw
    ? {
        id: activeUnlockRaw.id,
        durationLabel: activeUnlockRaw.durationLabel,
        unlockedAt: activeUnlockRaw.unlockedAt,
        unlockUntil: activeUnlockRaw.unlockUntil,
        reason: activeUnlockRaw.reason,
        unlockedByAdminId: activeUnlockRaw.unlockedByAdminId,
      }
    : null;

  if (!activeEnrollment) {
    return {
      accessState: activeUnlock ? "TEMPORARILY_UNLOCKED" : "LOCKED",
      isLocked: !activeUnlock,
      isTemporarilyUnlocked: Boolean(activeUnlock),
      amountDue: 0,
      currency,
      dueMonth: null,
      dueDate: null,
      unlockUntil: activeUnlock?.unlockUntil || null,
      daysOverdue: 0,
      activeUnlock,
      enrollmentId: null,
      courseId: null,
      courseTitle: null,
    };
  }

  const course = activeEnrollment.course;
  const enrollmentType = String(activeEnrollment.type || "GROUP")
    .trim()
    .toUpperCase();

  const monthlyBaseAmount =
    currency === "USD"
      ? enrollmentType === "ONE_TO_ONE"
        ? course?.oneToOneFeeUSD || 0
        : course?.groupFeeUSD || 0
      : enrollmentType === "ONE_TO_ONE"
        ? course?.oneToOneFeeINR || 0
        : course?.groupFeeINR || 0;

  // Find latest pending due for this enrollment if available
  const pendingDue = await prisma.monthlyDue.findFirst({
    where: {
      enrollmentId: activeEnrollment.id,
      status: "PENDING",
    },
    orderBy: { dueDate: "asc" },
  });

  const dueDate = activeEnrollment.nextDueDate || pendingDue?.dueDate || null;
  const dueMonth = pendingDue?.dueMonth || null;
  const amountDue = pendingDue?.amount || monthlyBaseAmount;

  if (!dueDate) {
    return {
      accessState: activeUnlock ? "TEMPORARILY_UNLOCKED" : "ACTIVE",
      isLocked: false,
      isTemporarilyUnlocked: Boolean(activeUnlock),
      amountDue: 0,
      currency,
      dueMonth: null,
      dueDate: null,
      unlockUntil: activeUnlock?.unlockUntil || null,
      daysOverdue: 0,
      activeUnlock,
      enrollmentId: activeEnrollment.id,
      courseId: course.id,
      courseTitle: course.title,
    };
  }

  const dueMs = dueDate.getTime();
  const nowMs = now.getTime();

  let daysOverdue = 0;
  if (nowMs >= dueMs) {
    daysOverdue = Math.floor((nowMs - dueMs) / MS_PER_DAY);
  }

  // Grace Period: Day 0 through Day 3 (i.e. < 4 full days = 4 * 24h)
  const gracePeriodEndMs = dueMs + 4 * MS_PER_DAY;

  let baseState: AccessState = "ACTIVE";
  if (nowMs < dueMs) {
    baseState = "ACTIVE";
  } else if (nowMs < gracePeriodEndMs) {
    baseState = "GRACE_PERIOD";
  } else {
    baseState = "LOCKED";
  }

  // Active admin unlock overrides LOCKED and GRACE_PERIOD
  const finalState: AccessState = activeUnlock
    ? "TEMPORARILY_UNLOCKED"
    : baseState;

  const isLocked = finalState === "LOCKED";
  const isTemporarilyUnlocked = finalState === "TEMPORARILY_UNLOCKED";

  return {
    accessState: finalState,
    isLocked,
    isTemporarilyUnlocked,
    amountDue: baseState === "ACTIVE" && !pendingDue ? 0 : amountDue,
    currency,
    dueMonth,
    dueDate,
    unlockUntil: activeUnlock?.unlockUntil || null,
    daysOverdue,
    activeUnlock,
    enrollmentId: activeEnrollment.id,
    courseId: course.id,
    courseTitle: course.title,
  };
}
