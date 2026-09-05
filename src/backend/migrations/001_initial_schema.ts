import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Enable extensions
  pgm.createExtension("pgcrypto", { ifNotExists: true });
  pgm.createExtension("citext", { ifNotExists: true });

  // Roles
  pgm.createTable("roles", {
    id: { type: "BIGSERIAL", primaryKey: true },
    name: { type: "VARCHAR(100)", notNull: true, unique: true },
    description: { type: "TEXT" },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });

  // Seed default roles
  pgm.sql(`
    INSERT INTO roles (name, description) VALUES
      ('Sales Representative', 'Build quotations, apply discounts, track fulfillment'),
      ('Sales Manager', 'Review/approve/reject quotations, configure policy'),
      ('Finance', 'Invoicing, payment reconciliation, credit notes'),
      ('Warehouse Manager', 'Inventory, fulfillment allocation, backorders'),
      ('Admin', 'System configuration, products, pricing, currencies');
  `);

  // Users
  pgm.createTable("users", {
    id: { type: "BIGSERIAL", primaryKey: true },
    email: { type: "CITEXT", notNull: true, unique: true },
    password_hash: { type: "VARCHAR(255)", notNull: true },
    first_name: { type: "VARCHAR(100)", notNull: true },
    last_name: { type: "VARCHAR(100)", notNull: true },
    role_id: { type: "BIGINT", notNull: true, references: "roles(id)" },
    is_active: { type: "BOOLEAN", notNull: true, default: true },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    updated_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("users", "is_active", { where: "is_active = true", name: "idx_users_active" });

  // Customer tiers
  pgm.createTable("customer_tiers", {
    id: { type: "BIGSERIAL", primaryKey: true },
    name: { type: "VARCHAR(100)", notNull: true, unique: true },
    description: { type: "TEXT" },
    discount_ceiling_pct: { type: "NUMERIC(5,2)", notNull: true, default: "0" },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });

  pgm.sql(`
    INSERT INTO customer_tiers (name, description, discount_ceiling_pct) VALUES
      ('Bronze', 'Entry-level tier', 5.00),
      ('Silver', 'Mid-level tier', 10.00),
      ('Gold', 'Premium tier', 15.00);
  `);

  // Customers
  pgm.createTable("customers", {
    id: { type: "BIGSERIAL", primaryKey: true },
    name: { type: "VARCHAR(255)", notNull: true },
    email: { type: "CITEXT", notNull: true, unique: true },
    company: { type: "VARCHAR(255)" },
    phone: { type: "VARCHAR(50)" },
    tier_id: { type: "BIGINT", notNull: true, references: "customer_tiers(id)" },
    status: { type: "VARCHAR(20)", notNull: true, default: "ACTIVE" },
    currency_code: { type: "VARCHAR(3)", notNull: true, default: "USD" },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    updated_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("customers", ["tier_id"], { name: "idx_customers_tier_id" });
  pgm.createIndex("customers", ["status", "created_at"], { name: "idx_customers_status_created_at" });

  // Categories
  pgm.createTable("categories", {
    id: { type: "BIGSERIAL", primaryKey: true },
    name: { type: "VARCHAR(255)", notNull: true },
    description: { type: "TEXT" },
    parent_id: { type: "BIGINT", references: "categories(id)" },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    updated_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });

  // Currencies
  pgm.createTable("currencies", {
    id: { type: "BIGSERIAL", primaryKey: true },
    code: { type: "VARCHAR(3)", notNull: true, unique: true },
    name: { type: "VARCHAR(100)", notNull: true },
    symbol: { type: "VARCHAR(10)", notNull: true },
    is_active: { type: "BOOLEAN", notNull: true, default: true },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });

  pgm.sql(`
    INSERT INTO currencies (code, name, symbol, is_active) VALUES
      ('USD', 'US Dollar', '$', true),
      ('EUR', 'Euro', '€', true),
      ('GBP', 'British Pound', '£', true),
      ('INR', 'Indian Rupee', '₹', true);
  `);

  // Exchange rates
  pgm.createTable("exchange_rates", {
    id: { type: "BIGSERIAL", primaryKey: true },
    from_currency_code: { type: "VARCHAR(3)", notNull: true, references: "currencies(code)" },
    to_currency_code: { type: "VARCHAR(3)", notNull: true, references: "currencies(code)" },
    rate: { type: "NUMERIC(18,6)", notNull: true },
    effective_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("exchange_rates", ["from_currency_code", "to_currency_code", "effective_at"], {
    name: "idx_exchange_rates_lookup",
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("exchange_rates");
  pgm.dropTable("currencies");
  pgm.dropTable("categories");
  pgm.dropTable("customers");
  pgm.dropTable("customer_tiers");
  pgm.dropTable("users");
  pgm.dropTable("roles");
}
