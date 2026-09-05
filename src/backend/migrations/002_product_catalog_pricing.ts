import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Products
  pgm.createTable("products", {
    id: { type: "BIGSERIAL", primaryKey: true },
    sku: { type: "VARCHAR(100)", notNull: true, unique: true },
    name: { type: "VARCHAR(255)", notNull: true },
    description: { type: "TEXT" },
    category_id: { type: "BIGINT", notNull: true, references: "categories(id)" },
    product_type: {
      type: "VARCHAR(20)",
      notNull: true,
      default: "ONE_TIME",
      check: "product_type IN ('ONE_TIME', 'RECURRING')",
    },
    base_cost: { type: "NUMERIC(18,4)", notNull: true },
    is_active: { type: "BOOLEAN", notNull: true, default: true },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    updated_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("products", ["category_id"], { name: "idx_products_category_id" });
  pgm.createIndex("products", ["name"], { where: "is_active = true", name: "idx_products_active_name" });

  // Product Variants
  pgm.createTable("product_variants", {
    id: { type: "BIGSERIAL", primaryKey: true },
    product_id: { type: "BIGINT", notNull: true, references: "products(id)", onDelete: "CASCADE" },
    sku: { type: "VARCHAR(100)", notNull: true, unique: true },
    name: { type: "VARCHAR(255)", notNull: true },
    attributes: { type: "JSONB", notNull: true, default: "{}" },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    updated_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("product_variants", ["product_id"], { name: "idx_product_variants_product_id" });

  // Price Lists
  pgm.createTable(
    "price_lists",
    {
      id: { type: "BIGSERIAL", primaryKey: true },
      name: { type: "VARCHAR(255)", notNull: true },
      customer_tier_id: { type: "BIGINT", notNull: true, references: "customer_tiers(id)" },
      currency_code: { type: "VARCHAR(3)", notNull: true, references: "currencies(code)" },
      is_active: { type: "BOOLEAN", notNull: true, default: true },
      created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
      updated_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    },
    {
      constraints: {
        unique: ["customer_tier_id", "currency_code"],
      },
    }
  );

  // Price List Items
  pgm.createTable(
    "price_list_items",
    {
      id: { type: "BIGSERIAL", primaryKey: true },
      price_list_id: { type: "BIGINT", notNull: true, references: "price_lists(id)", onDelete: "CASCADE" },
      product_id: { type: "BIGINT", notNull: true, references: "products(id)", onDelete: "CASCADE" },
      unit_price: { type: "NUMERIC(18,4)", notNull: true },
      created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
      updated_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    },
    {
      constraints: {
        unique: ["price_list_id", "product_id"],
      },
    }
  );
  pgm.createIndex("price_list_items", ["price_list_id", "product_id"], { name: "idx_price_list_items_lookup" });

  // Product Relationships
  pgm.createTable(
    "product_relationships",
    {
      id: { type: "BIGSERIAL", primaryKey: true },
      product_id: { type: "BIGINT", notNull: true, references: "products(id)", onDelete: "CASCADE" },
      related_product_id: { type: "BIGINT", notNull: true, references: "products(id)", onDelete: "CASCADE" },
      relationship_type: {
        type: "VARCHAR(20)",
        notNull: true,
        check: "relationship_type IN ('UPSELL', 'CROSS_SELL')",
      },
      created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    },
    {
      constraints: {
        unique: ["product_id", "related_product_id", "relationship_type"],
      },
    }
  );
  pgm.createIndex("product_relationships", ["product_id"], { name: "idx_product_relationships_product_id" });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("product_relationships");
  pgm.dropTable("price_list_items");
  pgm.dropTable("price_lists");
  pgm.dropTable("product_variants");
  pgm.dropTable("products");
}
