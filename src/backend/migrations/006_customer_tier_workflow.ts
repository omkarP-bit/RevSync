import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Commercial attributes consumed by the Customer Tier Engine.
  pgm.addColumn("customers", {
    customer_type: {
      type: "VARCHAR(20)",
      notNull: true,
      default: "BUSINESS",
      check: "customer_type IN ('INDIVIDUAL', 'BUSINESS', 'ENTERPRISE')",
    },
    expected_po_value: { type: "NUMERIC(18,4)", notNull: true, default: 0 },
    payment_terms: {
      type: "VARCHAR(20)",
      notNull: true,
      default: "NET_30",
      check: "payment_terms IN ('NET_15', 'NET_30', 'NET_60', 'ADVANCE', 'COD')",
    },
    upfront_payment_pct: { type: "NUMERIC(5,2)", notNull: true, default: 0 },
  });

  // Admin-configurable, auditable tier recommendation rules (deterministic, no AI).
  pgm.createTable("customer_tier_rules", {
    id: { type: "BIGSERIAL", primaryKey: true },
    name: { type: "VARCHAR(100)", notNull: true },
    target_tier: {
      type: "VARCHAR(10)",
      notNull: true,
      check: "target_tier IN ('BRONZE', 'SILVER', 'GOLD')",
    },
    customer_type: {
      type: "VARCHAR(20)",
      check: "customer_type IN ('INDIVIDUAL', 'BUSINESS', 'ENTERPRISE')",
    },
    min_expected_po_value: { type: "NUMERIC(18,2)" },
    min_upfront_payment_pct: { type: "NUMERIC(5,2)" },
    payment_terms: { type: "VARCHAR(20)[]", notNull: true, default: "{}" },
    is_active: { type: "BOOLEAN", notNull: true, default: true },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    updated_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("customer_tier_rules", ["target_tier", "is_active"], {
    name: "idx_customer_tier_rules_target_active",
  });

  // Evaluate / confirm / override workflow history for customers.
  pgm.createTable("customer_tier_evaluations", {
    id: { type: "BIGSERIAL", primaryKey: true },
    customer_id: { type: "BIGINT", notNull: true, references: "customers(id)" },
    status: {
      type: "VARCHAR(20)",
      notNull: true,
      default: "RECOMMENDED",
      check: "status IN ('RECOMMENDED', 'CONFIRMED', 'OVERRIDDEN')",
    },
    recommended_tier: {
      type: "VARCHAR(10)",
      notNull: true,
      check: "recommended_tier IN ('BRONZE', 'SILVER', 'GOLD')",
    },
    resolved_tier: {
      type: "VARCHAR(10)",
      check: "resolved_tier IN ('BRONZE', 'SILVER', 'GOLD')",
    },
    input_snapshot: { type: "JSONB", notNull: true },
    matched_rules: { type: "JSONB", notNull: true, default: "[]" },
    action_by: { type: "BIGINT", references: "users(id)" },
    action_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    reason: { type: "TEXT" },
  });
  pgm.createIndex("customer_tier_evaluations", ["customer_id", "action_at"], {
    name: "idx_customer_tier_evaluations_customer",
  });

  // Seed deterministic default rules mirroring the Phase 1 worked example.
  pgm.sql(`
    INSERT INTO customer_tier_rules
      (name, target_tier, customer_type, min_expected_po_value, min_upfront_payment_pct, payment_terms)
    VALUES
      ('Enterprise high-value advance', 'GOLD', 'ENTERPRISE', 2000000, 50, '{}'),
      ('Business mid-value', 'SILVER', 'BUSINESS', 500000, NULL, '{}'),
      ('Default', 'BRONZE', NULL, NULL, NULL, '{}');
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("customer_tier_evaluations");
  pgm.dropTable("customer_tier_rules");
  pgm.dropColumn("customers", [
    "customer_type",
    "expected_po_value",
    "payment_terms",
    "upfront_payment_pct",
  ]);
}
