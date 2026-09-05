import { describe, it, expect } from "vitest";
import { evaluateDiscounts, DiscountRule } from "../engines/discount-engine.js";

describe("Discount Engine - evaluateDiscounts", () => {
  const rules: DiscountRule[] = [
    { id: 1, customer_tier_id: 3, category_id: 1, max_discount_pct: 10, is_active: true },
    { id: 2, customer_tier_id: 3, category_id: 2, max_discount_pct: 20, is_active: true },
    { id: 3, customer_tier_id: 1, category_id: 1, max_discount_pct: 5, is_active: false },
  ];

  it("allows the configured max discount for the tier x category", () => {
    const outcome = evaluateDiscounts(3, rules, [
      { id: 1, product_id: 10, category_id: 1, line_subtotal: 1000, applied_discount_pct: 10 },
    ]);
    expect(outcome.lines[0].allowed_discount_pct).toBe(10);
    expect(outcome.lines[0].line_overage).toBe(0);
    expect(outcome.lines[0].is_flagged).toBe(false);
    expect(outcome.total_overage).toBe(0);
  });

  it("flags a line whose applied discount exceeds the allowed amount", () => {
    const outcome = evaluateDiscounts(3, rules, [
      { id: 1, product_id: 10, category_id: 1, line_subtotal: 1000, applied_discount_pct: 18 },
    ]);
    expect(outcome.lines[0].allowed_discount_pct).toBe(10);
    expect(outcome.lines[0].line_overage).toBe(8);
    expect(outcome.lines[0].is_flagged).toBe(true);
    expect(outcome.lines[0].reason).toContain("18");
    expect(outcome.total_overage).toBe(8);
  });

  it("treats missing rules as zero allowance (any discount is an overage)", () => {
    const outcome = evaluateDiscounts(1, rules, [
      { id: 1, product_id: 11, category_id: 5, line_subtotal: 500, applied_discount_pct: 3 },
    ]);
    expect(outcome.lines[0].allowed_discount_pct).toBe(0);
    expect(outcome.lines[0].line_overage).toBe(3);
    expect(outcome.lines[0].is_flagged).toBe(true);
  });

  it("ignores inactive rules", () => {
    const outcome = evaluateDiscounts(1, rules, [
      { id: 1, product_id: 10, category_id: 1, line_subtotal: 1000, applied_discount_pct: 4 },
    ]);
    expect(outcome.lines[0].allowed_discount_pct).toBe(0);
    expect(outcome.lines[0].line_overage).toBe(4);
  });

  it("sums per-line overages into the quotation total overage", () => {
    const outcome = evaluateDiscounts(3, rules, [
      { id: 1, product_id: 10, category_id: 1, line_subtotal: 1000, applied_discount_pct: 18 },
      { id: 2, product_id: 12, category_id: 2, line_subtotal: 2000, applied_discount_pct: 20 },
      { id: 3, product_id: 13, category_id: 2, line_subtotal: 1000, applied_discount_pct: 25 },
    ]);
    expect(outcome.total_overage).toBe(8 + 0 + 5);
    expect(outcome.lines.filter((l) => l.is_flagged)).toHaveLength(2);
  });

  it("computes allowed and applied discount amounts in currency", () => {
    const outcome = evaluateDiscounts(3, rules, [
      { id: 1, product_id: 10, category_id: 1, line_subtotal: 1000, applied_discount_pct: 10 },
    ]);
    expect(outcome.lines[0].allowed_discount_amount).toBe(100);
    expect(outcome.lines[0].applied_discount_amount).toBe(100);
  });
});