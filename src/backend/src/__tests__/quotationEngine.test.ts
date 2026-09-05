import { describe, it, expect } from "vitest";
import { calculateQuotation, InputLine } from "../engines/quotation-engine.js";

describe("Quotation Engine - calculateQuotation", () => {
  it("calculates single line subtotal, discount, margin, and tax correctly", () => {
    const lines: InputLine[] = [
      {
        product_id: 1,
        quantity: 10,
        unit_price: 100.0,
        unit_cost: 60.0,
        applied_discount_pct: 10.0, // 10% discount
      },
    ];

    const result = calculateQuotation(lines, 10.0); // 10% tax rate

    expect(result.lines[0].line_subtotal).toBe(1000.0);
    expect(result.lines[0].discount_amount).toBe(100.0);
    expect(result.lines[0].line_total).toBe(900.0);
    expect(result.lines[0].line_cost).toBe(600.0);
    expect(result.lines[0].line_margin).toBe(300.0);

    expect(result.subtotal).toBe(1000.0);
    expect(result.discount_total).toBe(100.0);
    expect(result.tax_total).toBe(90.0); // 10% of 900
    expect(result.grand_total).toBe(990.0);
    expect(result.total_cost).toBe(600.0);
    expect(result.margin_amount).toBe(300.0); // 900 - 600
    expect(result.margin_pct).toBe(33.33); // (300 / 900) * 100
    expect(result.total_overage).toBe(0);
    expect(result.risk_level).toBe("LOW");
  });

  it("handles multiple lines and computes header aggregations accurately", () => {
    const lines: InputLine[] = [
      { product_id: 1, quantity: 2, unit_price: 500.0, unit_cost: 300.0, applied_discount_pct: 0 },
      { product_id: 2, quantity: 5, unit_price: 200.0, unit_cost: 100.0, applied_discount_pct: 20.0 },
    ];

    const result = calculateQuotation(lines, 5.0); // 5% tax

    // Line 1: subtotal 1000, discount 0, total 1000, cost 600, margin 400
    // Line 2: subtotal 1000, discount 200, total 800, cost 500, margin 300
    expect(result.subtotal).toBe(2000.0);
    expect(result.discount_total).toBe(200.0);
    expect(result.tax_total).toBe(90.0); // 5% of 1800
    expect(result.grand_total).toBe(1890.0);
    expect(result.total_cost).toBe(1100.0);
    expect(result.margin_amount).toBe(700.0); // 1800 - 1100
    expect(result.margin_pct).toBe(38.89); // (700 / 1800) * 100
  });

  it("handles zero quantity gracefully by clamping to 1", () => {
    const lines: InputLine[] = [
      { product_id: 1, quantity: 0, unit_price: 100.0, unit_cost: 50.0, applied_discount_pct: 0 },
    ];
    const result = calculateQuotation(lines, 10.0);
    expect(result.lines[0].quantity).toBe(1);
    expect(result.subtotal).toBe(100.0);
  });
});
