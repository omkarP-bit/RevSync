import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn("customers", {
    calculated_tier_id: { type: "BIGINT", references: "customer_tiers(id)" },
    tier_override_id: { type: "BIGINT", references: "customer_tiers(id)" },
    tier_override_by: { type: "BIGINT", references: "users(id)" },
    tier_override_at: { type: "TIMESTAMPTZ" },
    tier_override_reason: { type: "TEXT" },
  });

  // Backfill calculated_tier_id from existing tier_id for existing rows
  pgm.sql(`UPDATE customers SET calculated_tier_id = tier_id WHERE calculated_tier_id IS NULL`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn("customers", [
    "calculated_tier_id",
    "tier_override_id",
    "tier_override_by",
    "tier_override_at",
    "tier_override_reason",
  ]);
}
