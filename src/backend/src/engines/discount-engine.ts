export interface DiscountRule {
  id: number;
  customer_tier_id: number;
  category_id: number;
  max_discount_pct: number;
  is_active: boolean;
}

export interface DiscountLineInput {
  id?: number;
  product_id: number;
  category_id: number;
  line_subtotal: number;
  applied_discount_pct: number;
}

export interface DiscountOutcomeLine extends DiscountLineInput {
  allowed_discount_pct: number;
  allowed_discount_amount: number;
  applied_discount_amount: number;
  line_overage: number;
  is_flagged: boolean;
  reason: string | null;
}

export interface DiscountOutcome {
  lines: DiscountOutcomeLine[];
  order_discount_pct: number;
  order_overage: number;
  total_allowed_discount_amount: number;
  total_applied_discount_amount: number;
  total_overage: number;
}

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

function round4(val: number): number {
  return Math.round((val + Number.EPSILON) * 10000) / 10000;
}

function findRule(
  rules: DiscountRule[],
  tierId: number,
  categoryId: number
): DiscountRule | undefined {
  return rules.find(
    (r) =>
      Number(r.customer_tier_id) === Number(tierId) &&
      Number(r.category_id) === Number(categoryId) &&
      r.is_active
  );
}

// Deterministic discount governance:
// - allowed_discount_pct comes from the active rule for the confirmed customer tier x product category.
// - line_overage = max(0, applied_discount_pct - allowed_discount_pct) in percentage points.
// - order_overage = orderDiscountPct (order-level discounts contribute directly to overage)
// - total_overage sums the per-line overages plus order_overage across the quotation.
export function evaluateDiscounts(
  tierId: number,
  rules: DiscountRule[],
  lines: DiscountLineInput[],
  orderDiscountPct: number = 0
): DiscountOutcome {
  let totalAllowed = 0;
  let totalApplied = 0;
  let lineOverageSum = 0;

  const evaluatedLines: DiscountOutcomeLine[] = lines.map((line) => {
    const subtotal = Math.max(0, line.line_subtotal);
    const appliedPct = Math.max(0, Math.min(100, line.applied_discount_pct || 0));
    const rule = findRule(rules, tierId, line.category_id);
    const allowedPct = rule ? Math.max(0, Math.min(100, rule.max_discount_pct)) : 0;

    const allowedAmount = round4(subtotal * (allowedPct / 100));
    const appliedAmount = round4(subtotal * (appliedPct / 100));
    const lineOverage = round2(Math.max(0, appliedPct - allowedPct));

    totalAllowed += allowedAmount;
    totalApplied += appliedAmount;
    lineOverageSum += lineOverage;

    let reason: string | null = null;
    if (appliedPct > allowedPct) {
      reason =
        allowedPct > 0
          ? `Applied ${appliedPct}% exceeds the allowed ${allowedPct}% for this customer tier and category (overage ${lineOverage}%).`
          : `No discount allowed for this customer tier and category; applied ${appliedPct}% (overage ${lineOverage}%).`;
    }

    return {
      ...line,
      allowed_discount_pct: round2(allowedPct),
      allowed_discount_amount: allowedAmount,
      applied_discount_amount: appliedAmount,
      line_overage: lineOverage,
      is_flagged: lineOverage > 0,
      reason,
    };
  });

  const validOrderDiscPct = Math.max(0, Math.min(100, orderDiscountPct || 0));
  const orderOverage = round2(validOrderDiscPct);
  const totalOverage = round2(lineOverageSum + orderOverage);

  return {
    lines: evaluatedLines,
    order_discount_pct: orderOverage,
    order_overage: orderOverage,
    total_allowed_discount_amount: round4(totalAllowed),
    total_applied_discount_amount: round4(totalApplied),
    total_overage: totalOverage,
  };
}