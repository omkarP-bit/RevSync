export interface InputLine {
  id?: number;
  product_id: number;
  product_variant_id?: number | null;
  description?: string | null;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  applied_discount_pct: number;
}

export interface CalculatedLine extends InputLine {
  line_subtotal: number;
  discount_amount: number;
  line_total: number;
  line_cost: number;
  line_margin: number;
}

export interface QuotationTotals {
  subtotal: number;
  discount_total: number;
  tax_rate_pct: number;
  tax_total: number;
  grand_total: number;
  total_cost: number;
  margin_amount: number;
  margin_pct: number;
  total_overage: number;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  lines: CalculatedLine[];
}

function round4(val: number): number {
  return Math.round((val + Number.EPSILON) * 10000) / 10000;
}

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function calculateQuotation(
  lines: InputLine[],
  taxRatePct: number = 10.00
): QuotationTotals {
  let subtotal = 0;
  let discount_total = 0;
  let total_cost = 0;

  const calculatedLines: CalculatedLine[] = lines.map((line) => {
    const qty = Math.max(1, line.quantity);
    const unitPrice = Math.max(0, line.unit_price);
    const unitCost = Math.max(0, line.unit_cost);
    const discPct = Math.max(0, Math.min(100, line.applied_discount_pct || 0));

    const line_subtotal = round4(qty * unitPrice);
    const discount_amount = round4(line_subtotal * (discPct / 100));
    const line_total = round4(line_subtotal - discount_amount);
    const line_cost = round4(qty * unitCost);
    const line_margin = round4(line_total - line_cost);

    subtotal += line_subtotal;
    discount_total += discount_amount;
    total_cost += line_cost;

    return {
      ...line,
      quantity: qty,
      unit_price: round4(unitPrice),
      unit_cost: round4(unitCost),
      applied_discount_pct: round2(discPct),
      line_subtotal,
      discount_amount,
      line_total,
      line_cost,
      line_margin,
    };
  });

  subtotal = round4(subtotal);
  discount_total = round4(discount_total);
  total_cost = round4(total_cost);

  const taxableBase = round4(subtotal - discount_total);
  const validTaxRate = Math.max(0, taxRatePct);
  const tax_total = round4(taxableBase * (validTaxRate / 100));
  const grand_total = round4(taxableBase + tax_total);

  const margin_amount = round4(taxableBase - total_cost);
  const margin_pct = taxableBase > 0 ? round2((margin_amount / taxableBase) * 100) : 0;

  return {
    subtotal,
    discount_total,
    tax_rate_pct: round2(validTaxRate),
    tax_total,
    grand_total,
    total_cost,
    margin_amount,
    margin_pct,
    total_overage: 0, // Stub contract for Phase 4
    risk_level: "LOW", // Stub contract for Phase 4
    lines: calculatedLines,
  };
}
