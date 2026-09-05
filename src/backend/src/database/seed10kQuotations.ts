import "dotenv/config";
import { v4 as uuidv4 } from "uuid";
import { getPool } from "./pool.js";
import { calculateQuotation } from "../engines/quotation-engine.js";

const COMPANY_NAMES = [
  "Acme Corp", "Globex Corporation", "Soylent Corp", "Initech", "Umbrella Corp",
  "Hooli", "Pied Piper", "Massive Dynamic", "Stark Industries", "Wayne Enterprises",
  "Cyberdyne Systems", "Aperture Science", "Bluth Company", "E Corp", "Vehement Capital",
  "Wonka Industries", "Oscorp", "Dunder Mifflin", "Sterling Cooper", "Sterling Archer Ltd",
  "Nakamoto Global", "Nexus Robotics", "Aether Analytics", "Vanguard Logistics", "Zenith Energy",
  "Omni Consumer Products", "Tyrell Corporation", "Weyland-Yutani", "Strickland Propane", "Paper Street Soap Co",
  "Blue Sun Corp", "Prestige Worldwide", "Tarzan Enterprises", "Monsters Inc", "Krusty Krab Holdings",
  "Los Pollos Hermanos", "Gekko & Co", "Duke & Duke", "Brawndo Corp", "Spacely Sprockets",
  "Cogswell Cogs", "Virtucon", "Extensive Enterprise", "Choam", "LuthorCorp",
  "LexCorp", "Kord Industries", "S.T.A.R. Labs", "Queen Industries", "Hammer Industries"
];

const STATUSES = [
  "DRAFT", "DRAFT", "DRAFT", "DRAFT",
  "PENDING_APPROVAL", "PENDING_APPROVAL",
  "APPROVED", "APPROVED",
  "CONFIRMED",
  "NEGOTIATION",
  "CANCELLED"
];

async function seed10kQuotations() {
  const pool = getPool();
  console.log("Starting bulk seed of 10,000 quotations...");
  const startTime = Date.now();

  // 1. Ensure realistic customers exist
  const existingCustomersRes = await pool.query("SELECT id, currency_code, tier_id FROM customers");
  let customerList = existingCustomersRes.rows;

  if (customerList.length < 50) {
    console.log(`Currently ${customerList.length} customers in DB. Seeding ${50 - customerList.length} additional customer companies...`);
    const tiersRes = await pool.query("SELECT id FROM customer_tiers");
    const tierIds = tiersRes.rows.map((r: any) => Number(r.id));
    const currencies = ["USD", "EUR", "INR", "GBP"];

    for (let i = customerList.length; i < COMPANY_NAMES.length; i++) {
      const company = COMPANY_NAMES[i];
      const tierId = tierIds[i % tierIds.length] || 1;
      const currency = currencies[i % currencies.length];
      const email = `contact@${company.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`;

      const inserted = await pool.query(
        `INSERT INTO customers (name, email, company, tier_id, status, currency_code)
         VALUES ($1, $2, $3, $4, 'ACTIVE', $5)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
         RETURNING id, currency_code, tier_id`,
        [company, email, company, tierId, currency]
      );
      customerList.push(inserted.rows[0]);
    }
  }

  // 2. Fetch Sales Reps and Products
  const usersRes = await pool.query(
    "SELECT id FROM users WHERE role_id IN (1, 2, 5) ORDER BY id ASC"
  );
  const salesRepIds = usersRes.rows.map((r: any) => Number(r.id));

  const productsRes = await pool.query("SELECT id, name, base_cost FROM products ORDER BY id ASC");
  const products = productsRes.rows;

  if (products.length === 0) {
    console.error("No products found in DB! Please seed products first.");
    process.exit(1);
  }

  // 3. Determine starting quotation count
  const countRes = await pool.query("SELECT COUNT(*) FROM quotations");
  const existingCount = parseInt(countRes.rows[0].count, 10);
  console.log(`Existing quotations in DB: ${existingCount}`);

  const TARGET_COUNT = 10000;
  const BATCH_SIZE = 1000;

  let totalInsertedQuotes = 0;
  let totalInsertedLines = 0;

  for (let batchStart = 0; batchStart < TARGET_COUNT; batchStart += BATCH_SIZE) {
    const currentBatchSize = Math.min(BATCH_SIZE, TARGET_COUNT - batchStart);
    const headersValues: any[] = [];
    const headersParamStrings: string[] = [];
    let paramIndex = 1;

    const batchQuoteCalculations: Array<{
      quoteNum: string;
      publicId: string;
      customerId: number;
      salesRepId: number;
      currencyCode: string;
      status: string;
      calc: ReturnType<typeof calculateQuotation>;
      linesInput: Array<{
        product_id: number;
        quantity: number;
        unit_price: number;
        unit_cost: number;
        applied_discount_pct: number;
      }>;
    }> = [];

    for (let i = 0; i < currentBatchSize; i++) {
      const quoteIndex = existingCount + batchStart + i + 1;
      const year = new Date().getFullYear();
      const quoteNum = `QT-${year}-${String(quoteIndex).padStart(5, "0")}`;
      const publicId = uuidv4();

      const customer = customerList[(quoteIndex - 1) % customerList.length];
      const salesRepId = salesRepIds[(quoteIndex - 1) % salesRepIds.length] || salesRepIds[0];
      const status = STATUSES[quoteIndex % STATUSES.length];
      const taxRatePct = 10.0;

      // Select 1 to 4 line items
      const numLines = (quoteIndex % 4) + 1;
      const rawLines = [];

      for (let l = 0; l < numLines; l++) {
        const prod = products[(quoteIndex + l) % products.length];
        const baseCost = Number(prod.base_cost) || 100;
        const unitPrice = Math.round(baseCost * (1.2 + ((l * 0.15) % 0.8)) * 100) / 100;
        const qty = ((quoteIndex + l) % 10) + 1;
        const discPct = (quoteIndex + l) % 5 === 0 ? 10.0 : (quoteIndex + l) % 7 === 0 ? 15.0 : 0.0;

        rawLines.push({
          product_id: Number(prod.id),
          quantity: qty,
          unit_price: unitPrice,
          unit_cost: baseCost,
          applied_discount_pct: discPct,
        });
      }

      const calc = calculateQuotation(rawLines, taxRatePct);

      batchQuoteCalculations.push({
        quoteNum,
        publicId,
        customerId: Number(customer.id),
        salesRepId,
        currencyCode: customer.currency_code || "USD",
        status,
        calc,
        linesInput: rawLines,
      });

      headersParamStrings.push(
        `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
      );

      headersValues.push(
        quoteNum,
        publicId,
        Number(customer.id),
        salesRepId,
        customer.currency_code || "USD",
        status,
        calc.subtotal,
        calc.discount_total,
        taxRatePct,
        calc.tax_total,
        calc.grand_total,
        calc.total_cost,
        calc.margin_amount,
        calc.margin_pct,
        `Seeded bulk quotation ${quoteNum}`
      );
    }

    // Insert headers batch and retrieve IDs
    const headerQuery = `
      INSERT INTO quotations (
        quotation_number, public_id, customer_id, sales_rep_id, currency_code,
        status, subtotal, discount_total, tax_rate_pct, tax_total,
        grand_total, total_cost, margin_amount, margin_pct, notes
      )
      VALUES ${headersParamStrings.join(", ")}
      RETURNING id, quotation_number`;

    const headerResult = await pool.query(headerQuery, headersValues);
    const quoteIdMap = new Map<string, number>();
    for (const row of headerResult.rows) {
      quoteIdMap.set(row.quotation_number, Number(row.id));
    }

    // Prepare line items batch
    const linesParamStrings: string[] = [];
    const linesValues: any[] = [];
    let lineParamIndex = 1;

    for (const item of batchQuoteCalculations) {
      const quoteId = quoteIdMap.get(item.quoteNum);
      if (!quoteId) continue;

      for (const line of item.calc.lines) {
        linesParamStrings.push(
          `($${lineParamIndex++}, $${lineParamIndex++}, $${lineParamIndex++}, $${lineParamIndex++}, $${lineParamIndex++}, $${lineParamIndex++}, $${lineParamIndex++}, $${lineParamIndex++}, $${lineParamIndex++}, $${lineParamIndex++}, $${lineParamIndex++})`
        );
        linesValues.push(
          quoteId,
          line.product_id,
          line.quantity,
          line.unit_price,
          line.unit_cost,
          line.applied_discount_pct,
          line.discount_amount,
          line.line_subtotal,
          line.line_total,
          line.line_cost,
          line.line_margin
        );
      }
    }

    if (linesValues.length > 0) {
      const linesQuery = `
        INSERT INTO quotation_lines (
          quotation_id, product_id, quantity, unit_price, unit_cost,
          applied_discount_pct, discount_amount, line_subtotal, line_total,
          line_cost, line_margin
        )
        VALUES ${linesParamStrings.join(", ")}`;
      await pool.query(linesQuery, linesValues);
    }

    totalInsertedQuotes += currentBatchSize;
    totalInsertedLines += linesValues.length / 11;
    console.log(`✓ Inserted batch of ${currentBatchSize} quotations (Progress: ${totalInsertedQuotes} / ${TARGET_COUNT})`);
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  const finalCountRes = await pool.query("SELECT COUNT(*) FROM quotations");
  console.log(`
🎉 SEEDING COMPLETE!
---------------------------------------
Inserted Quotations: ${totalInsertedQuotes.toLocaleString()}
Inserted Line Items: ${totalInsertedLines.toLocaleString()}
Total DB Quotations: ${Number(finalCountRes.rows[0].count).toLocaleString()}
Duration: ${durationSec} seconds
---------------------------------------
`);

  process.exit(0);
}

seed10kQuotations().catch((err) => {
  console.error("Seeding failed with error:", err);
  process.exit(1);
});
