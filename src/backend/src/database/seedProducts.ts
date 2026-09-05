import "dotenv/config";
import { query } from "./pool.js";

async function seedProductsAndPricing() {
  console.log("Seeding products, variants, and price lists...");

  // 1. Ensure Categories
  const catSoftware = await query(
    `INSERT INTO categories (name, description) VALUES ('Software Licenses', 'Enterprise software & subscriptions')
     ON CONFLICT DO NOTHING RETURNING id`
  );
  let categoryId = catSoftware.rows[0]?.id;
  if (!categoryId) {
    const existing = await query(`SELECT id FROM categories WHERE name = 'Software Licenses'`);
    categoryId = existing.rows[0].id;
  }

  // 2. Insert Products
  const products = [
    {
      sku: "SW-ENT-001",
      name: "RevSync Enterprise Platform",
      description: "Complete Quote-to-Cash Enterprise Platform",
      category_id: categoryId,
      product_type: "RECURRING",
      base_cost: 1500.00,
      is_active: true,
    },
    {
      sku: "CS-SUPP-001",
      name: "24/7 Cloud Operations Support",
      description: "Dedicated priority support & SLA guarantee",
      category_id: categoryId,
      product_type: "RECURRING",
      base_cost: 400.00,
      is_active: true,
    },
    {
      sku: "HW-GATEWAY-001",
      name: "IoT Edge Gateway Hardware",
      description: "On-premise secure gateway device",
      category_id: categoryId,
      product_type: "ONE_TIME",
      base_cost: 250.00,
      is_active: true,
    },
  ];

  const productMap = new Map<string, number>();

  for (const p of products) {
    const res = await query(
      `INSERT INTO products (sku, name, description, category_id, product_type, base_cost, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (sku) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         base_cost = EXCLUDED.base_cost
       RETURNING id, sku`,
      [p.sku, p.name, p.description, p.category_id, p.product_type, p.base_cost, p.is_active]
    );
    const prodId = Number(res.rows[0].id);
    productMap.set(p.sku, prodId);

    // Seed variant for this product
    await query(
      `INSERT INTO product_variants (product_id, sku, name, attributes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (sku) DO NOTHING`,
      [prodId, `${p.sku}-VAR1`, `${p.name} (Standard Pack)`, JSON.stringify({ tier: "standard" })]
    );
  }

  // 3. Fetch Tiers & Currencies
  const tiersRes = await query(`SELECT id, name FROM customer_tiers`);
  const currenciesRes = await query(`SELECT code FROM currencies`);

  const tiers = tiersRes.rows.map((t) => ({ id: Number(t.id), name: t.name }));
  const currencies = currenciesRes.rows.map((c) => c.code);

  // Price Multipliers relative to base cost & currency/tier
  const currencyRates: Record<string, number> = { USD: 1.0, EUR: 0.92, GBP: 0.79, INR: 83.5 };
  const tierDiscounts: Record<string, number> = { Bronze: 1.0, Silver: 0.9, Gold: 0.8 };

  for (const tier of tiers) {
    for (const curr of currencies) {
      const plName = `${tier.name} Tier - ${curr} Price List`;
      const plRes = await query(
        `INSERT INTO price_lists (name, customer_tier_id, currency_code, is_active)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (customer_tier_id, currency_code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [plName, tier.id, curr]
      );
      const priceListId = Number(plRes.rows[0].id);

      const rate = currencyRates[curr] || 1.0;
      const discount = tierDiscounts[tier.name] || 1.0;

      for (const [sku, prodId] of productMap.entries()) {
        const prodCost = products.find((p) => p.sku === sku)?.base_cost || 100;
        // Markup: cost * 1.5 * currencyRate * tierDiscount
        const unitPrice = Math.round(prodCost * 1.5 * rate * discount * 100) / 100;

        await query(
          `INSERT INTO price_list_items (price_list_id, product_id, unit_price)
           VALUES ($1, $2, $3)
           ON CONFLICT (price_list_id, product_id) DO UPDATE SET unit_price = EXCLUDED.unit_price`,
          [priceListId, prodId, unitPrice]
        );
      }
    }
  }

  // 4. Seed Product Relationships
  const entId = productMap.get("SW-ENT-001");
  const suppId = productMap.get("CS-SUPP-001");
  const gwId = productMap.get("HW-GATEWAY-001");

  if (entId && suppId) {
    await query(
      `INSERT INTO product_relationships (product_id, related_product_id, relationship_type)
       VALUES ($1, $2, 'CROSS_SELL')
       ON CONFLICT DO NOTHING`,
      [entId, suppId]
    );
  }

  if (entId && gwId) {
    await query(
      `INSERT INTO product_relationships (product_id, related_product_id, relationship_type)
       VALUES ($1, $2, 'UPSELL')
       ON CONFLICT DO NOTHING`,
      [entId, gwId]
    );
  }

  console.log("Product & Price List seeding complete!");
  process.exit(0);
}

seedProductsAndPricing().catch((err) => {
  console.error("Product seeding failed:", err);
  process.exit(1);
});
