// ─── Fee Constants ────────────────────────────────────────────────────────────

export const JOINING_FEE_INR = 1100;

export const ALLOWED_PAYMENT_MONTHS = [1, 3, 6, 12] as const;

export type EnrollmentMonths =
  (typeof ALLOWED_PAYMENT_MONTHS)[number];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BulkDiscountTier {
  months: number;
  discountPercent: number;
}

export type PaymentMode = "MONTHLY" | "FULL_COURSE";

export interface EnrollmentAmountResult {
  total: number;
  originalTotal: number;
  discountPercent: number;
  discountAmount: number;
  joiningFee: number;
  months: number;
}

// ─── Numeric Helpers ──────────────────────────────────────────────────────────

/**
 * Safely converts a value to a non-negative finite number.
 */
function toAmount(
  value: unknown,
  fallback = 0
): number {
  const n = Number(value);

  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(n)
  ) {
    return fallback;
  }

  return Math.max(0, n);
}

// ─── Payment Plan Validation ──────────────────────────────────────────────────

/**
 * Checks whether the requested payment plan is valid.
 *
 * Allowed plans:
 * 1, 3, 6, 12 months
 */
export function isValidEnrollmentMonths(
  months: number
): months is EnrollmentMonths {
  return ALLOWED_PAYMENT_MONTHS.includes(
    Math.floor(Number(months)) as EnrollmentMonths
  );
}

/**
 * Validates and normalizes the requested number of months.
 *
 * IMPORTANT:
 * Invalid values are NOT silently converted.
 */
export function validateEnrollmentMonths(
  months: number
): EnrollmentMonths {
  const normalized = Number(months);

  if (
    !Number.isInteger(normalized) ||
    !isValidEnrollmentMonths(normalized)
  ) {
    throw new Error(
      "Invalid payment plan. Allowed plans are 1, 3, 6, or 12 months."
    );
  }

  return normalized;
}

// ─── Discount Helpers ─────────────────────────────────────────────────────────

/**
 * Returns the best applicable discount percentage.
 *
 * Example:
 *
 * 3 months  -> 5%
 * 6 months  -> 10%
 * 12 months -> 15%
 *
 * 6 months  => 10%
 * 12 months => 15%
 */
export function getBestDiscount(
  months: number,
  tiers: BulkDiscountTier[]
): number {
  if (
    !tiers ||
    tiers.length === 0 ||
    !Number.isFinite(months) ||
    months <= 0
  ) {
    return 0;
  }

  const valid = tiers.filter(
    (tier) =>
      Number.isFinite(Number(tier.months)) &&
      Number(tier.months) > 0 &&
      Number.isFinite(Number(tier.discountPercent)) &&
      Number(tier.discountPercent) >= 0 &&
      Number(tier.discountPercent) <= 100
  );

  if (valid.length === 0) {
    return 0;
  }

  const sorted = [...valid].sort(
    (a, b) =>
      Number(b.months) - Number(a.months)
  );

  const applicable = sorted.find(
    (tier) =>
      months >= Number(tier.months)
  );

  return applicable
    ? toAmount(applicable.discountPercent)
    : 0;
}

// ─── Enrollment Pricing ──────────────────────────────────────────────────────

/**
 * Calculates the enrollment amount for the selected payment plan.
 *
 * Business rules:
 *
 * 1 month:
 *   monthly fee + joining fee
 *
 * 3 months:
 *   monthly fee × 3 - applicable discount
 *   NO joining fee
 *
 * 6 months:
 *   monthly fee × 6 - applicable discount
 *   NO joining fee
 *
 * 12 months:
 *   monthly fee × 12 - applicable discount
 *   NO joining fee
 */
export function calculateEnrollmentAmount(
  monthlyFee: number,
  months: number,
  tiers: BulkDiscountTier[] = [],
  joiningFee = JOINING_FEE_INR
): EnrollmentAmountResult {
  const safeMonthlyFee =
    toAmount(monthlyFee);

  const safeJoiningFee =
    toAmount(
      joiningFee,
      JOINING_FEE_INR
    );

  const validMonths =
    validateEnrollmentMonths(months);

  // Joining fee applies ONLY to the 1-month plan.
  const appliedJoiningFee =
    validMonths === 1
      ? safeJoiningFee
      : 0;

  const grossCourseAmount =
    safeMonthlyFee * validMonths;

  const discountPercent =
    validMonths === 1
      ? 0
      : getBestDiscount(
          validMonths,
          tiers
        );

  const discountAmount =
    Math.round(
      (grossCourseAmount *
        discountPercent) /
        100
    );

  const discountedCourseAmount =
    Math.max(
      0,
      grossCourseAmount -
        discountAmount
    );

  const total =
    discountedCourseAmount +
    appliedJoiningFee;

  return {
    total,

    originalTotal:
      grossCourseAmount +
      appliedJoiningFee,

    discountPercent,

    discountAmount,

    joiningFee:
      appliedJoiningFee,

    months:
      validMonths,
  };
}

// ─── Monthly Initial Enrollment ───────────────────────────────────────────────

/**
 * Calculates a 1-month initial enrollment.
 *
 * Monthly fee + joining fee.
 */
export function enrollmentAmountINR(
  monthlyFeeInr: number,
  joiningFeeInr?: number
): number {
  return calculateEnrollmentAmount(
    monthlyFeeInr,
    1,
    [],
    joiningFeeInr ??
      JOINING_FEE_INR
  ).total;
}

// ─── Bulk / Prepaid Enrollment ───────────────────────────────────────────────

/**
 * Calculates 3/6/12-month prepaid enrollment.
 *
 * Joining fee is NOT charged for prepaid plans.
 */
export function bulkPaymentAmountINR(
  monthlyFeeInr: number,
  months: number,
  tiers: BulkDiscountTier[],
  joiningFeeInr?: number
): EnrollmentAmountResult {
  return calculateEnrollmentAmount(
    monthlyFeeInr,
    months,
    tiers,
    joiningFeeInr ??
      JOINING_FEE_INR
  );
}

// ─── Renewal ──────────────────────────────────────────────────────────────────

/**
 * Calculates a subsequent monthly renewal.
 *
 * Renewal does NOT charge joining fee.
 */
export function monthlyRenewalAmountINR(
  monthlyFeeInr: number
): number {
  return toAmount(
    monthlyFeeInr
  );
}

/**
 * Calculates a renewal amount for any allowed
 * payment duration.
 *
 * IMPORTANT:
 * Joining fee is always zero for renewal.
 *
 * 1 month  => monthly fee
 * 3 months => monthly fee × 3 - discount
 * 6 months => monthly fee × 6 - discount
 * 12 months => monthly fee × 12 - discount
 */
export function calculateRenewalAmount(
  monthlyFee: number,
  months: number,
  tiers: BulkDiscountTier[] = []
): EnrollmentAmountResult {
  const safeMonthlyFee =
    toAmount(monthlyFee);

  const validMonths =
    validateEnrollmentMonths(months);

  const grossCourseAmount =
    safeMonthlyFee * validMonths;

  const discountPercent =
    validMonths === 1
      ? 0
      : getBestDiscount(
          validMonths,
          tiers
        );

  const discountAmount =
    Math.round(
      (grossCourseAmount *
        discountPercent) /
        100
    );

  const total =
    Math.max(
      0,
      grossCourseAmount -
        discountAmount
    );

  return {
    total,

    originalTotal:
      grossCourseAmount,

    discountPercent,

    discountAmount,

    joiningFee: 0,

    months:
      validMonths,
  };
}

// ─── Date Helpers ─────────────────────────────────────────────────────────────

const IST_OFFSET_MS =
  5.5 * 60 * 60 * 1000;

/**
 * Converts a Date to its IST calendar representation.
 */
function toISTParts(
  date: Date
): {
  year: number;
  month: number;
  day: number;
} {
  const istMs =
    date.getTime() +
    IST_OFFSET_MS;

  const ist =
    new Date(istMs);

  return {
    year:
      ist.getUTCFullYear(),

    month:
      ist.getUTCMonth(),

    day:
      ist.getUTCDate(),
  };
}

/**
 * Returns the UTC instant corresponding to:
 *
 * 1st of next month, 00:00 IST.
 */
export function nextMonthDueDate(
  from: Date = new Date()
): Date {
  const {
    year,
    month,
  } = toISTParts(from);

  const nextMonthIstMidnightUtcMs =
    Date.UTC(
      year,
      month + 1,
      1,
      0,
      0,
      0
    ) -
    IST_OFFSET_MS;

  return new Date(
    nextMonthIstMidnightUtcMs
  );
}

// ─── Coverage Month Helpers ───────────────────────────────────────────────────

/**
 * Returns MonthlyDue dueMonth values AFTER the
 * supplied start month.
 *
 * This function is retained for backwards compatibility.
 *
 * Example:
 *
 * startDate = September 2026
 * count = 3
 *
 * => October 2026
 * => November 2026
 * => December 2026
 *
 * DO NOT use this for determining the months
 * covered by a new prepaid payment.
 *
 * Use generateCoverageMonths() for coverage.
 */
export function generateDueMonths(
  startDate: Date,
  count: number
): string[] {
  const months: string[] = [];

  const safeCount =
    Number.isFinite(count) &&
    count > 0
      ? Math.floor(count)
      : 0;

  const {
    year,
    month,
  } = toISTParts(startDate);

  for (
    let i = 1;
    i <= safeCount;
    i++
  ) {
    const total =
      month + i;

    const y =
      year +
      Math.floor(
        total / 12
      );

    const m =
      ((total % 12) + 12) %
      12;

    months.push(
      `${y}-${String(
        m + 1
      ).padStart(2, "0")}`
    );
  }

  return months;
}

/**
 * Returns the calendar months actually covered
 * by a payment.
 *
 * IMPORTANT:
 * The starting month IS included.
 *
 * Example:
 *
 * Payment date:
 * September 10, 2026
 *
 * count = 3
 *
 * => September 2026
 * => October 2026
 * => November 2026
 */
export function generateCoverageMonths(
  startDate: Date,
  count: number
): string[] {
  const months: string[] = [];

  const safeCount =
    Number.isFinite(count) &&
    count > 0
      ? Math.floor(count)
      : 0;

  const {
    year,
    month,
  } = toISTParts(startDate);

  for (
    let i = 0;
    i < safeCount;
    i++
  ) {
    const total =
      month + i;

    const y =
      year +
      Math.floor(
        total / 12
      );

    const m =
      ((total % 12) + 12) %
      12;

    months.push(
      `${y}-${String(
        m + 1
      ).padStart(2, "0")}`
    );
  }

  return months;
}

/**
 * Returns the first day of the month immediately
 * after the covered period.
 *
 * Example:
 *
 * startDate = September 2026
 * count = 3
 *
 * Covered:
 * September
 * October
 * November
 *
 * Next due:
 * December 1, 2026 00:00 IST
 */
export function nextCoverageDueDate(
  startDate: Date,
  count: number
): Date {
  const safeCount =
    Number.isFinite(count) &&
    count > 0
      ? Math.floor(count)
      : 0;

  const {
    year,
    month,
  } = toISTParts(startDate);

  const total =
    month + safeCount;

  const nextYear =
    year +
    Math.floor(
      total / 12
    );

  const nextMonth =
    ((total % 12) + 12) %
    12;

  const nextMonthIstMidnightUtcMs =
    Date.UTC(
      nextYear,
      nextMonth,
      1,
      0,
      0,
      0
    ) -
    IST_OFFSET_MS;

  return new Date(
    nextMonthIstMidnightUtcMs
  );
}

// ─── Tier Parsing ─────────────────────────────────────────────────────────────

/**
 * Safely parses discount tiers coming from Prisma JSON.
 */
export const parseTiers = (
  raw: unknown
): BulkDiscountTier[] => {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter(
      (tier) =>
        typeof tier === "object" &&
        tier !== null &&
        "months" in tier &&
        "discountPercent" in tier
    )
    .map(
      (tier: any) => ({
        months:
          Number(
            tier.months
          ),

        discountPercent:
          Number(
            tier.discountPercent
          ),
      })
    )
    .filter(
      (tier) =>
        Number.isFinite(
          tier.months
        ) &&
        tier.months > 0 &&
        Number.isFinite(
          tier.discountPercent
        ) &&
        tier.discountPercent >= 0 &&
        tier.discountPercent <= 100
    );
};

// ─── Controller Backwards Compatibility ───────────────────────────────────────

/**
 * Existing controller adapter.
 *
 * Calculates a 1-month initial enrollment:
 *
 * monthly fee + joining fee
 */
export function calculateMonthlyEnrollmentAmount(
  monthlyFee: number,
  joiningFee: number
): number {
  return calculateEnrollmentAmount(
    monthlyFee,
    1,
    [],
    joiningFee
  ).total;
}

/**
 * Existing controller adapter.
 *
 * Calculates a prepaid 3/6/12-month enrollment.
 *
 * Joining fee is automatically zero
 * for 3/6/12 months.
 */
export function calculateBulkEnrollmentAmount(
  monthlyFee: number,
  months: number,
  tiers: BulkDiscountTier[]
): EnrollmentAmountResult {
  return calculateEnrollmentAmount(
    monthlyFee,
    months,
    tiers,
    JOINING_FEE_INR
  );
}