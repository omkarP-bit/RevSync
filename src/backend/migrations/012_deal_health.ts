import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Deal health signal weights: each signal is a configurable, explainable input
  // that rolls up into a HEALTHY / AT_RISK / CRITICAL status per deal.
  pgm.createTable("deal_health_signal_config", {
    id: { type: "BIGSERIAL", primaryKey: true },
    signal_key: { type: "VARCHAR(50)", notNull: true, unique: true },
    name: { type: "VARCHAR(255)", notNull: true },
    description: { type: "TEXT" },
    weight: { type: "NUMERIC(5,2)", notNull: true, default: 20 },
    is_enabled: { type: "BOOLEAN", notNull: true, default: true },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    updated_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("deal_health_signal_config", ["is_enabled"], {
    name: "idx_deal_health_signals_enabled",
  });

  // Deal health snapshots: the latest computed health state per deal (quotation).
  pgm.createTable("deal_health_snapshots", {
    id: { type: "BIGSERIAL", primaryKey: true },
    public_id: { type: "UUID", notNull: true, unique: true, default: pgm.func("gen_random_uuid()") },
    quotation_id: { type: "BIGINT", notNull: true, references: "quotations(id)" },
    customer_id: { type: "BIGINT", notNull: true, references: "customers(id)" },
    sales_rep_id: { type: "BIGINT", references: "users(id)" },
    status: {
      type: "VARCHAR(10)",
      notNull: true,
      check: "status IN ('HEALTHY', 'AT_RISK', 'CRITICAL')",
    },
    score: { type: "NUMERIC(5,2)", notNull: true },
    signals: { type: "JSONB", notNull: true, default: pgm.func("'[]'::jsonb") },
    computed_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    computed_by: { type: "BIGINT", references: "users(id)" },
  });
  pgm.createIndex("deal_health_snapshots", ["quotation_id"], {
    unique: true,
    name: "uq_deal_health_snapshots_quotation",
  });
  pgm.createIndex("deal_health_snapshots", ["status"], { name: "idx_deal_health_snapshots_status" });
  pgm.createIndex("deal_health_snapshots", ["customer_id"], { name: "idx_deal_health_snapshots_customer" });
  pgm.createIndex("deal_health_snapshots", ["sales_rep_id"], { name: "idx_deal_health_snapshots_sales_rep" });
  pgm.createIndex("deal_health_snapshots", ["score"], { name: "idx_deal_health_snapshots_score" });

  // Default signal weights (sum 100). Sales Manager can tune via the API.
  pgm.sql(`
    INSERT INTO deal_health_signal_config (signal_key, name, description, weight) VALUES
      ('STALLED_QUOTE', 'Stalled quote',
        'Quotation has not been updated for several days while still in an open status.', 30),
      ('APPROVAL_DELAY', 'Approval delay',
        'A pending approval request on the quotation has been waiting for several days.', 25),
      ('INVENTORY_SHORTAGE', 'Inventory shortage',
        'A confirmed quotation has a fulfillment order with backorders or partial allocation.', 20),
      ('HIGH_DISCOUNT_RISK', 'High discount risk',
        'Quotation risk level is HIGH or margin is below the healthy floor.', 15),
      ('NEGOTIATION_STALL', 'Negotiation stall',
        'An open negotiation channel has not progressed for several days.', 10);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("deal_health_snapshots");
  pgm.dropTable("deal_health_signal_config");
}