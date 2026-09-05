export type CustomerType = "INDIVIDUAL" | "BUSINESS" | "ENTERPRISE";
export type RecommendedTier = "BRONZE" | "SILVER" | "GOLD";

// Deterministic, configurable rule for recommending a customer tier from
// commercial attributes. Admin-maintainable (stored in customer_tier_rules).
export interface CustomerTierRule {
  id: number;
  name: string;
  target_tier: RecommendedTier;
  is_active: boolean;
  // Conditions all must hold for the rule to fire.
  customer_type?: CustomerType;
  min_expected_po_value?: number;
  min_upfront_payment_pct?: number;
  payment_terms?: string[]; // e.g. ["NET_30", "ADVANCE", "NET_60"]
}

export interface TierEvaluationInput {
  customer_type: CustomerType;
  expected_po_value: number;
  upfront_payment_pct: number;
  payment_terms: string;
}

export interface TierRuleMatch {
  rule_id: number;
  rule_name: string;
  target_tier: RecommendedTier;
  reason: string;
}

export interface TierEvaluationOutcome {
  recommended_tier: RecommendedTier;
  matched_rules: TierRuleMatch[];
}

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

// Evaluate a set of deterministic rules against a customer's commercial
// attributes. All conditions within a rule must hold. The most-specific
// firing rule wins: more defined conditions = higher priority; a rule with no
// conditions acts as the catch-all fallback. Ties resolve to the lowest id for
// determinism.
export function evaluateCustomerTier(
  input: TierEvaluationInput,
  rules: CustomerTierRule[]
): TierEvaluationOutcome {
  const activeRules = rules
    .filter((r) => r.is_active)
    .sort((a, b) => {
      const aSpecificity = ruleSpecificity(a);
      const bSpecificity = ruleSpecificity(b);
      if (aSpecificity !== bSpecificity) return bSpecificity - aSpecificity;
      return a.id - b.id;
    });

  const firing: TierRuleMatch[] = [];
  for (const rule of activeRules) {
    const conditionsMet =
      (rule.customer_type === undefined ||
        rule.customer_type === input.customer_type) &&
      (rule.min_expected_po_value === undefined ||
        input.expected_po_value >= rule.min_expected_po_value) &&
      (rule.min_upfront_payment_pct === undefined ||
        input.upfront_payment_pct >= rule.min_upfront_payment_pct) &&
      (rule.payment_terms === undefined ||
        rule.payment_terms.length === 0 ||
        rule.payment_terms.includes(input.payment_terms));

    if (conditionsMet) {
      firing.push({
        rule_id: rule.id,
        rule_name: rule.name,
        target_tier: rule.target_tier,
        reason: buildReason(input, rule),
      });
    }
  }

  if (firing.length === 0) {
    return { recommended_tier: "BRONZE", matched_rules: [] };
  }

  // Deterministic priority: the most-specific (then lowest-id) firing rule wins.
  const chosen = firing[0];
  return { recommended_tier: chosen.target_tier, matched_rules: firing };
}

// A rule is more specific the more conditions it defines. Rules with no
// conditions are the least specific (catch-all fallback).
function ruleSpecificity(rule: CustomerTierRule): number {
  let n = 0;
  if (rule.customer_type !== undefined) n++;
  if (rule.min_expected_po_value !== undefined) n++;
  if (rule.min_upfront_payment_pct !== undefined) n++;
  if (rule.payment_terms !== undefined && rule.payment_terms.length > 0) n++;
  return n;
}

function paymentTermLabel(term: string): string {
  const map: Record<string, string> = {
    NET_15: "Net 15",
    NET_30: "Net 30",
    NET_60: "Net 60",
    ADVANCE: "Advance",
    COD: "Cash on Delivery",
  };
  return map[term] ?? term;
}

function customerTypeLabel(type: CustomerType): string {
  return type.charAt(0) + type.slice(1).toLowerCase();
}

function buildReason(input: TierEvaluationInput, rule: CustomerTierRule): string {
  const parts: string[] = [];
  if (rule.customer_type !== undefined) {
    parts.push(`customer type is ${customerTypeLabel(rule.customer_type)}`);
  }
  if (rule.min_expected_po_value !== undefined) {
    parts.push(
      `expected PO value ${input.expected_po_value.toLocaleString()} >= ${round2(
        rule.min_expected_po_value
      ).toLocaleString()}`
    );
  }
  if (rule.min_upfront_payment_pct !== undefined) {
    parts.push(
      `upfront payment ${input.upfront_payment_pct}% >= ${round2(
        rule.min_upfront_payment_pct
      )}%`
    );
  }
  if (
    rule.payment_terms !== undefined &&
    rule.payment_terms.length > 0
  ) {
    parts.push(`payment term ${paymentTermLabel(input.payment_terms)}`);
  }
  return `Rule "${rule.name}" matched: ${parts.join(", ")}.`;
}
