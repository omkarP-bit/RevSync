import "dotenv/config";
import { query } from "./pool.js";

// Phase 4: discount budgets by customer tier x product category, and the
// multi-step approval rules keyed to the resulting discount overage.
async function seedPhase4() {
  console.log("Seeding discount & approval rules...");

  // 1. Discount rule: Gold tier x Software Licenses -> max 10% discount.
  const tierRes = await query(`SELECT id FROM customer_tiers WHERE name = 'Gold'`);
  if (tierRes.rows.length === 0) {
    console.error("Gold customer tier not found!");
    process.exit(1);
  }
  const goldTierId = tierRes.rows[0].id;

  const catRes = await query(`SELECT id FROM categories WHERE name = 'Software Licenses'`);
  if (catRes.rows.length === 0) {
    console.error("Software Licenses category not found!");
    process.exit(1);
  }
  const softwareCatId = catRes.rows[0].id;

  const existingRule = await query(
    `SELECT id FROM discount_rules
     WHERE customer_tier_id = $1 AND category_id = $2 AND is_active = true`,
    [goldTierId, softwareCatId]
  );

  if (existingRule.rows.length > 0) {
    await query(
      `UPDATE discount_rules SET max_discount_pct = 10.00, is_active = true
       WHERE id = $1`,
      [existingRule.rows[0].id]
    );
    console.log(`✓ Updated discount rule (Gold x Software Licenses) to 10%`);
  } else {
    await query(
      `INSERT INTO discount_rules (customer_tier_id, category_id, max_discount_pct, is_active)
       VALUES ($1, $2, 10.00, true)`,
      [goldTierId, softwareCatId]
    );
    console.log(`✓ Created discount rule (Gold x Software Licenses) at 10%`);
  }

  // 2. Approval rules keyed to total overage (percentage points).
  const approvalRules = [
    { risk_level: "MEDIUM", min_total_overage: 5.0, role_sequence: [2] },
    { risk_level: "HIGH", min_total_overage: 8.0, role_sequence: [2, 3] },
  ];

  for (const rule of approvalRules) {
    await query(
      `INSERT INTO approval_rules (risk_level, min_total_overage, role_sequence, is_active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT DO NOTHING`,
      [rule.risk_level, rule.min_total_overage, rule.role_sequence]
    );
    // Keep the row active and up-to-date regardless of previous state.
    await query(
      `UPDATE approval_rules
       SET min_total_overage = $2, role_sequence = $3, is_active = true
       WHERE risk_level = $1`,
      [rule.risk_level, rule.min_total_overage, rule.role_sequence]
    );
    console.log(
      `✓ Seeded approval rule ${rule.risk_level}: overage >= ${rule.min_total_overage} pts -> chain [${rule.role_sequence}]`
    );
  }

  console.log("Phase 4 seeding complete!");
  process.exit(0);
}

seedPhase4().catch((err) => {
  console.error("Phase 4 seeding failed:", err);
  process.exit(1);
});