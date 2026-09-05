import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Invoices: generated from a CONFIRMED quotation (one-time lines only).
  pgm.createTable("invoices", {
    id: { type: "BIGSERIAL", primaryKey: true },
    invoice_number: { type: "VARCHAR(50)", notNull: true, unique: true },
    public_id: { type: "UUID", notNull: true, unique: true, default: pgm.func("gen_random_uuid()") },
    quotation_id: { type: "BIGINT", notNull: true, unique: true, references: "quotations(id)" },
    customer_id: { type: "BIGINT", notNull: true, references: "customers(id)" },
    currency_code: { type: "VARCHAR(3)", notNull: true, references: "currencies(code)" },
    status: {
      type: "VARCHAR(20)",
      notNull: true,
      default: "ISSUED",
      check: "status IN ('ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED')",
    },
    issue_date: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    due_date: { type: "TIMESTAMPTZ", notNull: true },
    subtotal: { type: "NUMERIC(18,4)", notNull: true, default: 0 },
    discount_total: { type: "NUMERIC(18,4)", notNull: true, default: 0 },
    order_discount_pct: { type: "NUMERIC(5,2)", notNull: true, default: 0 },
    order_discount_amount: { type: "NUMERIC(18,4)", notNull: true, default: 0 },
    tax_rate_pct: { type: "NUMERIC(5,2)", notNull: true, default: 10.0 },
    tax_total: { type: "NUMERIC(18,4)", notNull: true, default: 0 },
    grand_total: { type: "NUMERIC(18,4)", notNull: true, default: 0 },
    total_paid: { type: "NUMERIC(18,4)", notNull: true, default: 0 },
    notes: { type: "TEXT" },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    updated_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("invoices", ["customer_id"], { name: "idx_invoices_customer_id" });
  pgm.createIndex("invoices", ["status", "created_at"], { name: "idx_invoices_status_created" });
  pgm.createIndex("invoices", ["due_date"], { name: "idx_invoices_due_date" });

  // Invoice lines: snapshot of the invoiced one-time quotation lines.
  pgm.createTable("invoice_lines", {
    id: { type: "BIGSERIAL", primaryKey: true },
    invoice_id: { type: "BIGINT", notNull: true, references: "invoices(id)", onDelete: "CASCADE" },
    quotation_line_id: { type: "BIGINT", references: "quotation_lines(id)" },
    product_id: { type: "BIGINT", notNull: true, references: "products(id)" },
    product_name: { type: "VARCHAR(255)", notNull: true },
    sku: { type: "VARCHAR(100)", notNull: true },
    description: { type: "TEXT" },
    quantity: { type: "INTEGER", notNull: true, check: "quantity > 0" },
    unit_price: { type: "NUMERIC(18,4)", notNull: true },
    applied_discount_pct: { type: "NUMERIC(5,2)", notNull: true, default: 0 },
    discount_amount: { type: "NUMERIC(18,4)", notNull: true, default: 0 },
    line_subtotal: { type: "NUMERIC(18,4)", notNull: true },
    line_total: { type: "NUMERIC(18,4)", notNull: true },
    unit_cost: { type: "NUMERIC(18,4)", notNull: true },
    line_cost: { type: "NUMERIC(18,4)", notNull: true },
    line_margin: { type: "NUMERIC(18,4)", notNull: true },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("invoice_lines", ["invoice_id"], { name: "idx_invoice_lines_invoice_id" });
  pgm.createIndex("invoice_lines", ["product_id"], { name: "idx_invoice_lines_product_id" });

  // Invoice payments: idempotent via a unique external reference.
  pgm.createTable("invoice_payments", {
    id: { type: "BIGSERIAL", primaryKey: true },
    invoice_id: { type: "BIGINT", notNull: true, references: "invoices(id)" },
    reference: { type: "VARCHAR(120)", notNull: true, unique: true },
    amount_paid: { type: "NUMERIC(18,4)", notNull: true, check: "amount_paid > 0" },
    payment_date: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    payment_method: {
      type: "VARCHAR(20)",
      notNull: true,
      default: "BANK_TRANSFER",
      check: "payment_method IN ('CASH', 'BANK_TRANSFER', 'CARD', 'CHECK', 'OTHER')",
    },
    received_by: { type: "BIGINT", references: "users(id)" },
    notes: { type: "TEXT" },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("invoice_payments", ["invoice_id", "payment_date"], {
    name: "idx_invoice_payments_invoice_id",
  });

  // Credit notes: adjustments against issued invoices.
  pgm.createTable("credit_notes", {
    id: { type: "BIGSERIAL", primaryKey: true },
    credit_note_number: { type: "VARCHAR(50)", notNull: true, unique: true },
    public_id: { type: "UUID", notNull: true, unique: true, default: pgm.func("gen_random_uuid()") },
    invoice_id: { type: "BIGINT", references: "invoices(id)" },
    customer_id: { type: "BIGINT", notNull: true, references: "customers(id)" },
    currency_code: { type: "VARCHAR(3)", notNull: true, references: "currencies(code)" },
    amount: { type: "NUMERIC(18,4)", notNull: true, check: "amount > 0" },
    reason: { type: "TEXT", notNull: true },
    status: {
      type: "VARCHAR(10)",
      notNull: true,
      default: "ISSUED",
      check: "status IN ('ISSUED', 'APPLIED', 'VOID')",
    },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    updated_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("credit_notes", ["invoice_id"], { name: "idx_credit_notes_invoice_id" });
  pgm.createIndex("credit_notes", ["customer_id"], { name: "idx_credit_notes_customer_id" });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("credit_notes");
  pgm.dropTable("invoice_payments");
  pgm.dropTable("invoice_lines");
  pgm.dropTable("invoices");
}