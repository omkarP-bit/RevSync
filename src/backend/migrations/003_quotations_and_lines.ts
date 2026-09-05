import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Quotations
  pgm.createTable("quotations", {
    id: { type: "BIGSERIAL", primaryKey: true },
    quotation_number: { type: "VARCHAR(50)", notNull: true, unique: true },
    public_id: { type: "UUID", notNull: true, unique: true, default: pgm.func("gen_random_uuid()") },
    customer_id: { type: "BIGINT", notNull: true, references: "customers(id)" },
    sales_rep_id: { type: "BIGINT", notNull: true, references: "users(id)" },
    currency_code: { type: "VARCHAR(3)", notNull: true, references: "currencies(code)" },
    status: {
      type: "VARCHAR(20)",
      notNull: true,
      default: "DRAFT",
      check: "status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'NEGOTIATION', 'CONFIRMED', 'CANCELLED')",
    },
    subtotal: { type: "NUMERIC(18,4)", notNull: true, default: 0 },
    discount_total: { type: "NUMERIC(18,4)", notNull: true, default: 0 },
    tax_rate_pct: { type: "NUMERIC(5,2)", notNull: true, default: 10.00 },
    tax_total: { type: "NUMERIC(18,4)", notNull: true, default: 0 },
    grand_total: { type: "NUMERIC(18,4)", notNull: true, default: 0 },
    total_cost: { type: "NUMERIC(18,4)", notNull: true, default: 0 },
    margin_amount: { type: "NUMERIC(18,4)", notNull: true, default: 0 },
    margin_pct: { type: "NUMERIC(5,2)", notNull: true, default: 0 },
    total_overage: { type: "NUMERIC(18,4)", notNull: true, default: 0 },
    risk_level: {
      type: "VARCHAR(10)",
      notNull: true,
      default: "LOW",
      check: "risk_level IN ('LOW', 'MEDIUM', 'HIGH')",
    },
    notes: { type: "TEXT" },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    updated_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });

  pgm.createIndex("quotations", ["quotation_number"], { name: "idx_quotations_number" });
  pgm.createIndex("quotations", ["public_id"], { name: "idx_quotations_public_id" });
  pgm.createIndex("quotations", ["customer_id"], { name: "idx_quotations_customer_id" });
  pgm.createIndex("quotations", ["sales_rep_id", "status"], { name: "idx_quotations_sales_rep_status" });
  pgm.createIndex("quotations", ["status", "created_at"], { name: "idx_quotations_status_created" });

  // Quotation Lines
  pgm.createTable("quotation_lines", {
    id: { type: "BIGSERIAL", primaryKey: true },
    quotation_id: { type: "BIGINT", notNull: true, references: "quotations(id)", onDelete: "CASCADE" },
    product_id: { type: "BIGINT", notNull: true, references: "products(id)" },
    product_variant_id: { type: "BIGINT", references: "product_variants(id)" },
    description: { type: "TEXT" },
    quantity: { type: "INTEGER", notNull: true, check: "quantity > 0" },
    unit_price: { type: "NUMERIC(18,4)", notNull: true },
    unit_cost: { type: "NUMERIC(18,4)", notNull: true },
    applied_discount_pct: { type: "NUMERIC(5,2)", notNull: true, default: 0 },
    discount_amount: { type: "NUMERIC(18,4)", notNull: true, default: 0 },
    line_subtotal: { type: "NUMERIC(18,4)", notNull: true },
    line_total: { type: "NUMERIC(18,4)", notNull: true },
    line_cost: { type: "NUMERIC(18,4)", notNull: true },
    line_margin: { type: "NUMERIC(18,4)", notNull: true },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    updated_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });

  pgm.createIndex("quotation_lines", ["quotation_id"], { name: "idx_quotation_lines_quotation_id" });
  pgm.createIndex("quotation_lines", ["product_id"], { name: "idx_quotation_lines_product_id" });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("quotation_lines");
  pgm.dropTable("quotations");
}
