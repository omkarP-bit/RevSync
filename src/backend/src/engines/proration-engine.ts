import { calculatePeriodDays, calculateRemainingDays } from "./subscription-cycle-engine.js";

export interface ProrationInput {
  oldUnitPrice: number;
  newUnitPrice: number;
  oldQuantity: number;
  newQuantity: number;
  periodStart: Date;
  periodEnd: Date;
  effectiveDate?: Date;
}

export interface ProrationResult {
  oldPeriodValue: number;
  newPeriodValue: number;
  periodDays: number;
  remainingDays: number;
  remainingFraction: number;
  prorationAmount: number;
}

/**
 * Calculates daily rate proration for subscription upgrades, downgrades, and quantity modifications.
 *
 * Formula:
 *   Period Days = Period End - Period Start
 *   Remaining Days = Period End - Effective Date
 *   Remaining Fraction = Remaining Days / Period Days
 *   Old Period Value = Old Unit Price * Old Quantity
 *   New Period Value = New Unit Price * New Quantity
 *   Proration Amount = (New Period Value - Old Period Value) * Remaining Fraction
 */
export function calculateProration(input: ProrationInput): ProrationResult {
  const effective = input.effectiveDate ? new Date(input.effectiveDate) : new Date();
  const start = new Date(input.periodStart);
  const end = new Date(input.periodEnd);

  const periodDays = calculatePeriodDays(start, end);
  const remainingDays = calculateRemainingDays(effective, end);
  const remainingFraction = Math.min(1, Math.max(0, remainingDays / periodDays));

  const oldPeriodValue = Number((input.oldUnitPrice * input.oldQuantity).toFixed(4));
  const newPeriodValue = Number((input.newUnitPrice * input.newQuantity).toFixed(4));

  const prorationAmountRaw = (newPeriodValue - oldPeriodValue) * remainingFraction;
  const prorationAmount = Number(prorationAmountRaw.toFixed(4));

  return {
    oldPeriodValue,
    newPeriodValue,
    periodDays,
    remainingDays,
    remainingFraction: Number(remainingFraction.toFixed(6)),
    prorationAmount,
  };
}

/**
 * Calculates unused prepaid value for subscription cancellation mid-cycle.
 *
 * Formula:
 *   Unused Value = Current Period Value * (Remaining Days / Period Days)
 */
export function calculateUnusedPrepaidValue(
  unitPrice: number,
  quantity: number,
  periodStart: Date,
  periodEnd: Date,
  effectiveDate?: Date
): { periodDays: number; remainingDays: number; unusedValue: number } {
  const effective = effectiveDate ? new Date(effectiveDate) : new Date();
  const start = new Date(periodStart);
  const end = new Date(periodEnd);

  const periodDays = calculatePeriodDays(start, end);
  const remainingDays = calculateRemainingDays(effective, end);
  const remainingFraction = Math.min(1, Math.max(0, remainingDays / periodDays));

  const periodValue = unitPrice * quantity;
  const unusedValue = Number((periodValue * remainingFraction).toFixed(4));

  return {
    periodDays,
    remainingDays,
    unusedValue,
  };
}
