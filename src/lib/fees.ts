export const JOINING_FEE_INR = 1100;

export function enrollmentAmountINR(monthlyFeeInr: number) {
  const fee = Number(monthlyFeeInr) || 0;
  return fee + JOINING_FEE_INR;
}
