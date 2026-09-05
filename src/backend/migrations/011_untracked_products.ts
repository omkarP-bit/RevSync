import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Some products (software licenses, subscriptions, services) are delivered
  // digitally and must NOT be counted in per-region inventory. `track_inventory`
  // marks whether a product participates in warehouse stock at all.
  pgm.addColumns("products", {
    track_inventory: { type: "BOOLEAN", notNull: true, default: true },
  });
  pgm.createIndex("products", ["track_inventory"], {
    name: "idx_products_track_inventory",
  });

  // Demo data: only physical hardware ships from warehouses. Software/cloud/
  // services SKUs (SW-, CS-, PS-) and ad-hoc smoke products are untracked.
  pgm.sql(`
    UPDATE products
       SET track_inventory = false
     WHERE sku LIKE 'SW-%' OR sku LIKE 'CS-%' OR sku LIKE 'PS-%' OR sku LIKE 'SMK-%'
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex("products", "idx_products_track_inventory");
  pgm.dropColumns("products", ["track_inventory"]);
}