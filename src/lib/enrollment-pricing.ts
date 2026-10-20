import { parseTiers, calculateRenewalAmount, nextCoverageDueDate } from "./fees";

export function enrollmentMonthlyFee(enrollment: any, currency: string, at: Date = new Date()): number {
  if (enrollment.agreedMonthlyFee != null) {
    if (enrollment.feeCurrency !== currency) throw new Error("Enrollment fee currency does not match payment currency.");
    const changes = (Array.isArray(enrollment.feeHistory) ? enrollment.feeHistory : [])
      .filter((entry: any) => entry.event === "FEE_CHANGED" && Number.isFinite(Date.parse(entry.effectiveFrom)))
      .sort((a: any, b: any) => Date.parse(a.effectiveFrom) - Date.parse(b.effectiveFrom));
    let amount = changes.length ? Number(changes[0].oldAmount) : Number(enrollment.agreedMonthlyFee);
    for (const entry of changes) if (Date.parse(entry.effectiveFrom) <= at.getTime()) amount = Number(entry.amount);
    return amount;
  }
  const course = enrollment.course;
  return Number(currency === "USD"
    ? enrollment.type === "ONE_TO_ONE" ? course.oneToOneFeeUSD || 0 : course.groupFeeUSD || 0
    : enrollment.type === "ONE_TO_ONE" ? course.oneToOneFeeINR || 0 : course.groupFeeINR || 0);
}
export function enrollmentDiscountTiers(enrollment: any, currency: string) {
  return enrollment.agreedMonthlyFee != null ? [] : parseTiers(enrollment.course.bulkDiscountTiers, currency);
}
export function validateAgreedFee(value: unknown, currency: string): number {
  const fee = Number(value);
  if (!Number.isFinite(fee) || fee <= 0 || Math.abs(fee * 100 - Math.round(fee * 100)) > 0.00001 || (currency === "INR" && !Number.isInteger(fee))) {
    throw new Error("Enter a valid monthly fee (whole rupees for INR, up to two decimals for USD).");
  }
  return fee;
}

export function enrollmentRenewalPricing(enrollment: any, currency: string, months: number) {
  const start = enrollment.nextDueDate || new Date();
  const base = enrollmentMonthlyFee(enrollment, currency, start);
  const result = calculateRenewalAmount(base, months, enrollmentDiscountTiers(enrollment, currency));
  if (enrollment.agreedMonthlyFee == null) return result;
  let total = 0;
  for (let index = 0; index < months; index++) {
    const date = nextCoverageDueDate(start, index, enrollment.billingAnchorDate || enrollment.createdAt);
    total += enrollmentMonthlyFee(enrollment, currency, date);
  }
  return { ...result, total, originalTotal: total, discountAmount: 0, discountPercent: 0 };
}
