import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumns("quotations", {
    order_discount_pct: { type: "NUMERIC(5,2)", notNull: true, default: 0 },
    order_discount_amount: { type: "NUMERIC(18,4)", notNull: true, default: 0 },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumns("quotations", ["order_discount_pct", "order_discount_amount"]);
}
