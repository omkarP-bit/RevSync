export type BillingCycle = "MONTHLY" | "QUARTERLY" | "YEARLY";

/**
 * Calculates period end date by adding billing cycle duration to start date.
 */
export function addBillingPeriod(startDate: Date, billingCycle: BillingCycle): Date {
  const result = new Date(startDate.getTime());
  switch (billingCycle) {
    case "MONTHLY":
      result.setMonth(result.getMonth() + 1);
      break;
    case "QUARTERLY":
      result.setMonth(result.getMonth() + 3);
      break;
    case "YEARLY":
      result.setFullYear(result.getFullYear() + 1);
      break;
  }
  return result;
}

/**
 * Calculates total number of days in a billing period.
 */
export function calculatePeriodDays(startDate: Date, endDate: Date): number {
  const diffMs = endDate.getTime() - startDate.getTime();
  return Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Calculates remaining days in current billing period from effective date.
 */
export function calculateRemainingDays(effectiveDate: Date, endDate: Date): number {
  const diffMs = endDate.getTime() - effectiveDate.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}
