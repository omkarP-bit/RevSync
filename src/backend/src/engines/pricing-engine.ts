export interface PriceListMatch {
  price_list_id: number;
  price_list_name: string;
  customer_tier_id: number;
  currency_code: string;
  product_id: number;
  unit_price: number;
}

export function resolveUnitPrice(
  priceListEntries: PriceListMatch[],
  productId: number,
  tierId: number,
  currencyCode: string
): { unitPrice: number | null; priceListId: number | null; priceListName: string | null } {
  const match = priceListEntries.find(
    (e) =>
      Number(e.product_id) === Number(productId) &&
      Number(e.customer_tier_id) === Number(tierId) &&
      e.currency_code.toUpperCase() === currencyCode.toUpperCase()
  );

  if (!match) {
    return { unitPrice: null, priceListId: null, priceListName: null };
  }

  return {
    unitPrice: Number(match.unit_price),
    priceListId: Number(match.price_list_id),
    priceListName: match.price_list_name,
  };
}
