import { describe, it, expect } from "vitest";
import {
  evaluateCustomerTier,
  CustomerTierRule,
  CustomerType,
} from "../engines/customer-tier-engine.js";

const defaultRules: CustomerTierRule[] = [
  {
    id: 1,
    name: "Enterprise high-value advance",
    target_tier: "GOLD",
    customer_type: "ENTERPRISE",
    min_expected_po_value: 2000000,
    min_upfront_payment_pct: 50,
    is_active: true,
  },
  {
    id: 2,
    name: "Business mid-value",
    target_tier: "SILVER",
    customer_type: "BUSINESS",
    min_expected_po_value: 500000,
    is_active: true,
  },
  {
    id: 3,
    name: "Default",
    target_tier: "BRONZE",
    is_active: true,
  },
];

describe("Customer Tier Engine", () => {
  it("recommends GOLD when all premium conditions are met", () => {
    const outcome = evaluateCustomerTier(
      {
        customer_type: "ENTERPRISE",
        expected_po_value: 2500000,
        upfront_payment_pct: 100,
        payment_terms: "NET_30",
      },
      defaultRules
    );
    expect(outcome.recommended_tier).toBe("GOLD");
  });

  it("recommends GOLD with an explainable reason", () => {
    const outcome = evaluateCustomerTier(
      {
        customer_type: "ENTERPRISE",
        expected_po_value: 2500000,
        upfront_payment_pct: 100,
        payment_terms: "NET_30",
      },
      defaultRules
    );
    expect(outcome.matched_rules.length).toBeGreaterThan(0);
    expect(outcome.matched_rules[0].rule_name).toBe("Enterprise high-value advance");
    expect(outcome.matched_rules[0].reason).toContain("customer type is Enterprise");
  });

  it("does not recommend GOLD when expected PO value is too low", () => {
    const outcome = evaluateCustomerTier(
      {
        customer_type: "ENTERPRISE",
        expected_po_value: 1000000,
        upfront_payment_pct: 100,
        payment_terms: "NET_30",
      },
      defaultRules
    );
    expect(outcome.recommended_tier).toBe("BRONZE");
  });

  it("recommends SILVER for a BUSINESS with sufficient PO value", () => {
    const outcome = evaluateCustomerTier(
      {
        customer_type: "BUSINESS",
        expected_po_value: 800000,
        upfront_payment_pct: 0,
        payment_terms: "NET_30",
      },
      defaultRules
    );
    expect(outcome.recommended_tier).toBe("SILVER");
  });

  it("defaults to BRONZE when no specific rule fires", () => {
    const outcome = evaluateCustomerTier(
      {
        customer_type: "INDIVIDUAL",
        expected_po_value: 1000,
        upfront_payment_pct: 0,
        payment_terms: "NET_30",
      },
      defaultRules
    );
    expect(outcome.recommended_tier).toBe("BRONZE");
  });

  it("returns an empty match list when no rule fires", () => {
    const rules: CustomerTierRule[] = defaultRules.filter((r) => r.id !== 3);
    const outcome = evaluateCustomerTier(
      {
        customer_type: "INDIVIDUAL",
        expected_po_value: 1000,
        upfront_payment_pct: 0,
        payment_terms: "NET_30",
      },
      rules
    );
    expect(outcome.recommended_tier).toBe("BRONZE");
    expect(outcome.matched_rules).toHaveLength(0);
  });

  it("ignores inactive rules", () => {
    const inactive: CustomerTierRule[] = [
      { ...defaultRules[0], is_active: false },
      { ...defaultRules[2] },
    ];
    const outcome = evaluateCustomerTier(
      {
        customer_type: "ENTERPRISE",
        expected_po_value: 2500000,
        upfront_payment_pct: 100,
        payment_terms: "NET_30",
      },
      inactive
    );
    expect(outcome.recommended_tier).toBe("BRONZE");
  });

  it("matches on payment terms when configured", () => {
    const rules: CustomerTierRule[] = [
      {
        id: 10,
        name: "Advance payer bonus",
        target_tier: "GOLD",
        customer_type: "BUSINESS",
        payment_terms: ["ADVANCE"],
        is_active: true,
      },
      { ...defaultRules[2] },
    ];
    const outcome = evaluateCustomerTier(
      {
        customer_type: "BUSINESS",
        expected_po_value: 100000,
        upfront_payment_pct: 50,
        payment_terms: "ADVANCE",
      },
      rules
    );
    expect(outcome.recommended_tier).toBe("GOLD");
  });

  it("is deterministic (first active rule by id wins on ties)", () => {
    const ties: CustomerTierRule[] = [
      { id: 5, name: "Rule A", target_tier: "GOLD", customer_type: "ENTERPRISE", is_active: true },
      { id: 9, name: "Rule B", target_tier: "SILVER", customer_type: "ENTERPRISE", is_active: true },
    ];
    const outcome = evaluateCustomerTier(
      {
        customer_type: "ENTERPRISE",
        expected_po_value: 100000,
        upfront_payment_pct: 0,
        payment_terms: "NET_30",
      },
      ties
    );
    expect(outcome.recommended_tier).toBe("GOLD");
  });
});
