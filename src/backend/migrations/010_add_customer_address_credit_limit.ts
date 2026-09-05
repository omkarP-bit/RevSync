import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn("customers", {
    billing_address: { type: "TEXT" },
    shipping_address: { type: "TEXT" },
    credit_limit: { type: "NUMERIC(18,2)", notNull: true, default: 0 },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn("customers", ["billing_address", "shipping_address", "credit_limit"]);
}
