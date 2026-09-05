import "dotenv/config";
import { query } from "./pool.js";

// Phase 5: warehouses and starting stock levels for fulfillment allocation.
async function seedPhase5() {
  console.log("Seeding warehouses & inventory...");

  const userIdRes = await query(`SELECT id FROM users ORDER BY id ASC LIMIT 1`);
  if (userIdRes.rows.length === 0) {
    console.error("No users found; run seed.ts first!");
    process.exit(1);
  }

  const warehouses = [
    { name: "Mumbai Main", code: "MUM-01", address: "1 BKC, Bandra Kurla Complex, Mumbai", base_shipping_cost: 5.0 },
    { name: "Delhi NCR", code: "DEL-01", address: "Okhla Industrial Estate, New Delhi", base_shipping_cost: 8.0 },
    { name: "Bengaluru South", code: "BLR-01", address: "Electronic City, Bengaluru", base_shipping_cost: 7.0 },
  ];

  const warehouseIds = new Map<string, number>();
  for (const wh of warehouses) {
    const existing = await query(`SELECT id FROM warehouses WHERE code = $1`, [wh.code]);
    let id: number;
    if (existing.rows.length > 0) {
      id = Number(existing.rows[0].id);
      await query(
        `UPDATE warehouses SET name = $1, address = $2, base_shipping_cost = $3, is_active = true
         WHERE id = $4`,
        [wh.name, wh.address, wh.base_shipping_cost, id]
      );
    } else {
      const inserted = await query(
        `INSERT INTO warehouses (name, code, address, base_shipping_cost, is_active)
         VALUES ($1, $2, $3, $4, true)
         RETURNING id`,
        [wh.name, wh.code, wh.address, wh.base_shipping_cost]
      );
      id = Number(inserted.rows[0].id);
    }
    warehouseIds.set(wh.code, id);
    console.log(`✓ Warehouse ${wh.code} ready (id ${id})`);
  }

  // Stock the seeded products so fulfillment has something to allocate.
  const stockPlan: Record<string, { [code: string]: number }> = {
    "SW-ENT-001": { "MUM-01": 25, "DEL-01": 15, "BLR-01": 10 },
    "CS-SUPP-001": { "MUM-01": 40, "DEL-01": 30 },
    "HW-GATEWAY-001": { "MUM-01": 5, "BLR-01": 12 },
  };

  const products = await query(`SELECT id, sku FROM products`);
  for (const product of products.rows as any[]) {
    const plan = stockPlan[(product.sku as string).toUpperCase()];
    if (!plan) continue;
    for (const [code, qty] of Object.entries(plan)) {
      const warehouseId = warehouseIds.get(code);
      if (!warehouseId) continue;
      await query(
        `INSERT INTO inventory_items (warehouse_id, product_id, quantity_on_hand, reorder_threshold)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (warehouse_id, product_id)
         DO UPDATE SET quantity_on_hand = $3, updated_at = NOW()`,
        [warehouseId, Number(product.id), qty, 5]
      );
    }
  }
  console.log("✓ Inventory stock levels configured");

  console.log("Phase 5 seeding complete!");
  process.exit(0);
}

seedPhase5().catch((err) => {
  console.error("Phase 5 seeding failed:", err);
  process.exit(1);
});