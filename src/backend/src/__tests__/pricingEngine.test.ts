import { describe, it, expect } from "vitest";
import { resolveUnitPrice, PriceListMatch } from "../engines/pricing-engine.js";

describe("Pricing Engine - resolveUnitPrice", () => {
  const samplePriceLists: PriceListMatch[] = [
    {
      price_list_id: 1,
      price_list_name: "Gold Tier - USD",
      customer_tier_id: 3, // Gold
      currency_code: "USD",
      product_id: 10,
      unit_price: 1200.0,
    },
    {
      price_list_id: 2,
      price_list_name: "Silver Tier - EUR",
      customer_tier_id: 2, // Silver
      currency_code: "EUR",
      product_id: 10,
      unit_price: 950.0,
    },
  ];

  it("resolves unit price correctly for matching tier and currency", () => {
    const result = resolveUnitPrice(samplePriceLists, 10, 3, "USD");
    expect(result.unitPrice).toBe(1200.0);
    expect(result.priceListId).toBe(1);
    expect(result.priceListName).toBe("Gold Tier - USD");
  });

  it("handles case insensitivity for currency codes", () => {
    const result = resolveUnitPrice(samplePriceLists, 10, 2, "eur");
    expect(result.unitPrice).toBe(950.0);
    expect(result.priceListId).toBe(2);
  });

  it("returns null values when no matching price list exists", () => {
    const result = resolveUnitPrice(samplePriceLists, 10, 1, "USD"); // Bronze tier not in list
    expect(result.unitPrice).toBeNull();
    expect(result.priceListId).toBeNull();
    expect(result.priceListName).toBeNull();
  });
});
