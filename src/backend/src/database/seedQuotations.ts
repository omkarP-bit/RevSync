import "dotenv/config";
import { query } from "./pool.js";
import { calculateQuotation } from "../engines/quotation-engine.js";

async function seedQuotations() {
  console.log("Seeding sample quotations...");

  // 1. Fetch sales rep, customers, products
  const repRes = await query(`SELECT id FROM users WHERE email = 'sales@revsync.com'`);
  const salesRepId = repRes.rows[0]?.id || 3;

  const custRes = await query(`SELECT id, currency_code FROM customers LIMIT 2`);
  if (custRes.rows.length === 0) {
    console.log("No customers found. Creating a sample customer first...");
    const tierRes = await query(`SELECT id FROM customer_tiers LIMIT 1`);
    const tierId = tierRes.rows[0]?.id || 1;
    const newCust = await query(
      `INSERT INTO customers (name, email, company, tier_id, currency_code)
       VALUES ('Acme Corp', 'contact@acme.com', 'Acme Enterprises', $1, 'USD')
       RETURNING id, currency_code`,
      [tierId]
    );
    custRes.rows.push(newCust.rows[0]);
  }

  const prodRes = await query(`SELECT id, name, base_cost FROM products LIMIT 3`);
  if (prodRes.rows.length === 0) {
    console.error("No products found to create quotations!");
    process.exit(1);
  }

  const customer = custRes.rows[0];
  const products = prodRes.rows;

  // Create 2 sample quotes
  const quotesToSeed = [
    { status: "DRAFT", notes: "Draft quote for Q3 enterprise renewal" },
    { status: "PENDING_APPROVAL", notes: "Discount request submitted for review" },
  ];

  for (let i = 0; i < quotesToSeed.length; i++) {
    const q = quotesToSeed[i];
    const year = new Date().getFullYear();
    const qNum = `QT-${year}-00${i + 1}`;

    const quoteInsert = await query(
      `INSERT INTO quotations (quotation_number, customer_id, sales_rep_id, currency_code, status, tax_rate_pct, notes)
       VALUES ($1, $2, $3, $4, $5, 10.00, $6)
       ON CONFLICT (quotation_number) DO UPDATE SET status = EXCLUDED.status
       RETURNING id`,
      [qNum, customer.id, salesRepId, customer.currency_code, q.status, q.notes]
    );

    const quoteId = quoteInsert.rows[0].id;

    // Add lines for this quote
    const lines = [
      {
        product_id: Number(products[0].id),
        quantity: 5,
        unit_price: Number(products[0].base_cost) * 1.5,
        unit_cost: Number(products[0].base_cost),
        applied_discount_pct: 5.0,
      },
      {
        product_id: Number(products[1]?.id || products[0].id),
        quantity: 2,
        unit_price: Number(products[1]?.base_cost || products[0].base_cost) * 1.4,
        unit_cost: Number(products[1]?.base_cost || products[0].base_cost),
        applied_discount_pct: 0.0,
      },
    ];

    const calc = calculateQuotation(lines, 10.00);

    for (const l of calc.lines) {
      await query(
        `INSERT INTO quotation_lines
           (quotation_id, product_id, quantity, unit_price, unit_cost, applied_discount_pct,
            discount_amount, line_subtotal, line_total, line_cost, line_margin)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          quoteId,
          l.product_id,
          l.quantity,
          l.unit_price,
          l.unit_cost,
          l.applied_discount_pct,
          l.discount_amount,
          l.line_subtotal,
          l.line_total,
          l.line_cost,
          l.line_margin,
        ]
      );
    }

    await query(
      `UPDATE quotations SET
         subtotal = $1, discount_total = $2, tax_total = $3, grand_total = $4,
         total_cost = $5, margin_amount = $6, margin_pct = $7
       WHERE id = $8`,
      [
        calc.subtotal,
        calc.discount_total,
        calc.tax_total,
        calc.grand_total,
        calc.total_cost,
        calc.margin_amount,
        calc.margin_pct,
        quoteId,
      ]
    );

    console.log(`✓ Seeded quotation ${qNum} (ID: ${quoteId}) with status ${q.status}`);
  }

  console.log("Quotations seeding complete!");
  process.exit(0);
}

seedQuotations().catch((err) => {
  console.error("Quotations seeding failed:", err);
  process.exit(1);
});
