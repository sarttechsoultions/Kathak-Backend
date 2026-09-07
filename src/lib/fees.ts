// ─── Fee Constants ────────────────────────────────────────────────────────────
export const JOINING_FEE_INR = 1100;

// ─── Types ────────────────────────────────────────────────────────────────────
export interface BulkDiscountTier {
  months: number;
  discountPercent: number;
}

export type PaymentMode = "MONTHLY" | "FULL_COURSE";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Safely coerces a value to a non-negative number, falling back to `fallback`.
 * Fixes the old `Number(x) ?? fallback` bug (0/NaN never triggers `??`).
 */
function toAmount(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (value === null || value === undefined || Number.isNaN(n)) return fallback;
  return Math.max(0, n);
}

/**
 * Returns the best applicable discount percent for paying `months` at once.
 * Picks the tier with the highest `months` that is <= the requested months.
 */
export function getBestDiscount(months: number, tiers: BulkDiscountTier[]): number {
  if (!tiers || tiers.length === 0 || !Number.isFinite(months) || months <= 0) return 0;

  const valid = tiers.filter(
    (t) => Number.isFinite(t.months) && t.months > 0 &&
           Number.isFinite(t.discountPercent) && t.discountPercent >= 0 && t.discountPercent <= 100
  );

  const sorted = [...valid].sort((a, b) => b.months - a.months);
  const applicable = sorted.find((t) => months >= t.months);
  return applicable?.discountPercent ?? 0;
}

/**
 * Monthly enrollment: first month fee + joining fee.
 * joiningFee defaults to JOINING_FEE_INR if not provided or invalid.
 */
export function enrollmentAmountINR(monthlyFeeInr: number, joiningFeeInr?: number) {
  const fee = toAmount(monthlyFeeInr);
  const joining = toAmount(joiningFeeInr, JOINING_FEE_INR);
  return fee + joining;
}

/**
 * Full-course / bulk payment: total for `months` months with discount applied.
 * Joining fee is added once on top.
 */
export function bulkPaymentAmountINR(
  monthlyFeeInr: number,
  months: number,
  tiers: BulkDiscountTier[],
  joiningFeeInr?: number
): { total: number; originalTotal: number; discountPercent: number; discountAmount: number } {
  const monthly = toAmount(monthlyFeeInr);
  const safeMonths = Number.isFinite(months) && months > 0 ? Math.floor(months) : 0;
  const joining = toAmount(joiningFeeInr, JOINING_FEE_INR);

  const gross = monthly * safeMonths;
  const discountPercent = getBestDiscount(safeMonths, tiers);
  const discountAmount = Math.round((gross * discountPercent) / 100);
  const discounted = Math.max(0, gross - discountAmount);

  return {
    originalTotal: gross + joining,
    discountAmount,
    discountPercent,
    total: discounted + joining,
  };
}

/**
 * Calculates the amount for a subsequent monthly payment (no joining fee).
 */
export function monthlyRenewalAmountINR(monthlyFeeInr: number): number {
  return toAmount(monthlyFeeInr);
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Converts a Date to its IST calendar representation without locale-string round-tripping. */
function toISTParts(date: Date): { year: number; month: number; day: number } {
  const istMs = date.getTime() + IST_OFFSET_MS;
  const ist = new Date(istMs);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth(),
    day: ist.getUTCDate(),
  };
}

/**
 * Returns the UTC instant corresponding to the 1st of next month, midnight IST.
 */
export function nextMonthDueDate(from: Date = new Date()): Date {
  const { year, month } = toISTParts(from);
  // Midnight IST on the 1st of next month, expressed as a UTC instant.
  const nextMonthIstMidnightUtcMs =
    Date.UTC(year, month + 1, 1, 0, 0, 0) - IST_OFFSET_MS;
  return new Date(nextMonthIstMidnightUtcMs);
}

/**
 * Returns an array of MonthlyDue dueMonth strings (YYYY-MM) for `count` months
 * starting from startDate (IST calendar months).
 */
export function generateDueMonths(startDate: Date, count: number): string[] {
  const months: string[] = [];
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  const { year, month } = toISTParts(startDate);

  for (let i = 1; i <= safeCount; i++) {
    const total = month + i;
    const y = year + Math.floor(total / 12);
    const m = ((total % 12) + 12) % 12;
    months.push(`${y}-${String(m + 1).padStart(2, "0")}`);
  }
  return months;
}