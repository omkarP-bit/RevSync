import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Warehouses: physical fulfillment locations.
  pgm.createTable(
    "warehouses",
    {
      id: { type: "BIGSERIAL", primaryKey: true },
      name: { type: "VARCHAR(255)", notNull: true },
      code: { type: "VARCHAR(50)", notNull: true, unique: true },
      address: { type: "TEXT" },
      base_shipping_cost: { type: "NUMERIC(12,2)", notNull: true, default: 0 },
      is_active: { type: "BOOLEAN", notNull: true, default: true },
      created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
      updated_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    },
    {
      constraints: {
        check: "base_shipping_cost >= 0",
      },
    }
  );
  pgm.createIndex("warehouses", ["is_active", "name"], { name: "idx_warehouses_active_name" });

  // Inventory Items: on-hand stock per product per warehouse.
  pgm.createTable("inventory_items", {
    id: { type: "BIGSERIAL", primaryKey: true },
    product_id: { type: "BIGINT", notNull: true, references: "products(id)" },
    warehouse_id: { type: "BIGINT", notNull: true, references: "warehouses(id)" },
    quantity_on_hand: { type: "INTEGER", notNull: true, default: 0 },
    reorder_threshold: { type: "INTEGER", notNull: true, default: 5 },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    updated_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("inventory_items", ["product_id", "warehouse_id"], {
    unique: true,
    name: "uq_inventory_product_warehouse",
  });
  pgm.createIndex("inventory_items", ["warehouse_id"], { name: "idx_inventory_items_warehouse_id" });

  // Fulfillment Orders: one per CONFIRMED quotation, carrying the allocation outcome.
  pgm.createTable(
    "fulfillment_orders",
    {
      id: { type: "BIGSERIAL", primaryKey: true },
      quotation_id: { type: "BIGINT", notNull: true, references: "quotations(id)" },
      status: {
        type: "VARCHAR(20)",
        notNull: true,
        default: "ALLOCATED",
        check: "status IN ('ALLOCATED', 'PARTIAL', 'BACKORDERED', 'SHIPPED', 'CANCELLED')",
      },
      shipping_cost: { type: "NUMERIC(12,2)", notNull: true, default: 0 },
      backordered_quantity: { type: "INTEGER", notNull: true, default: 0 },
      shipped_at: { type: "TIMESTAMPTZ" },
      created_by: { type: "BIGINT", notNull: true, references: "users(id)" },
      notes: { type: "TEXT" },
      created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
      updated_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    },
    {
      constraints: {
        unique: ["quotation_id"],
      },
    }
  );
  pgm.createIndex("fulfillment_orders", ["status", "created_at"], {
    name: "idx_fulfillment_orders_status_created",
  });
  pgm.createIndex("fulfillment_orders", ["quotation_id"], {
    name: "idx_fulfillment_orders_quotation_id",
  });

  // Fulfillment Allocations: the actual warehouse reservation per product, one row per warehouse.
  pgm.createTable("fulfillment_allocations", {
    id: { type: "BIGSERIAL", primaryKey: true },
    fulfillment_order_id: { type: "BIGINT", notNull: true, references: "fulfillment_orders(id)", onDelete: "CASCADE" },
    quotation_line_id: { type: "BIGINT", notNull: true, references: "quotation_lines(id)" },
    product_id: { type: "BIGINT", notNull: true, references: "products(id)" },
    warehouse_id: { type: "BIGINT", notNull: true, references: "warehouses(id)" },
    quantity: { type: "INTEGER", notNull: true },
    unit_shipping_cost: { type: "NUMERIC(12,2)", notNull: true, default: 0 },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("fulfillment_allocations", ["fulfillment_order_id"], {
    name: "idx_fulfillment_allocations_order_id",
  });
  pgm.createIndex("fulfillment_allocations", ["warehouse_id"], {
    name: "idx_fulfillment_allocations_warehouse_id",
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("fulfillment_allocations");
  pgm.dropTable("fulfillment_orders");
  pgm.dropTable("inventory_items");
  pgm.dropTable("warehouses");
}