import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  // 1. Subscription Plans
  pgm.createTable("subscription_plans", {
    id: { type: "BIGSERIAL", primaryKey: true },
    name: { type: "VARCHAR(255)", notNull: true },
    description: { type: "TEXT" },
    price: { type: "NUMERIC(18,4)", notNull: true },
    currency: { type: "VARCHAR(3)", notNull: true, references: "currencies(code)" },
    billing_cycle: {
      type: "VARCHAR(20)",
      notNull: true,
      default: "MONTHLY",
      check: "billing_cycle IN ('MONTHLY', 'QUARTERLY', 'YEARLY')",
    },
    proration_method: {
      type: "VARCHAR(20)",
      notNull: true,
      default: "DAILY",
      check: "proration_method IN ('DAILY')",
    },
    cancellation_policy: { type: "TEXT" },
    credit_allowance: { type: "NUMERIC(18,4)", notNull: true, default: 0 },
    credit_unit_value: { type: "NUMERIC(18,4)", notNull: true, default: 0 },
    is_active: { type: "BOOLEAN", notNull: true, default: true },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    updated_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("subscription_plans", ["name"], { name: "idx_sub_plans_name" });
  pgm.createIndex("subscription_plans", ["is_active"], { name: "idx_sub_plans_active" });

  // 2. Subscriptions
  pgm.createTable("subscriptions", {
    id: { type: "BIGSERIAL", primaryKey: true },
    public_id: { type: "UUID", notNull: true, unique: true, default: pgm.func("gen_random_uuid()") },
    customer_id: { type: "BIGINT", notNull: true, references: "customers(id)" },
    quotation_id: { type: "BIGINT", references: "quotations(id)" },
    quotation_line_id: { type: "BIGINT", references: "quotation_lines(id)" },
    subscription_plan_id: { type: "BIGINT", references: "subscription_plans(id)" },
    product_id: { type: "BIGINT", notNull: true, references: "products(id)" },
    status: {
      type: "VARCHAR(20)",
      notNull: true,
      default: "ACTIVE",
      check: "status IN ('ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED')",
    },
    quantity: { type: "INTEGER", notNull: true, check: "quantity > 0" },
    unit_price: { type: "NUMERIC(18,4)", notNull: true },
    currency: { type: "VARCHAR(3)", notNull: true, references: "currencies(code)" },
    start_date: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    end_date: { type: "TIMESTAMPTZ" },
    current_period_start: { type: "TIMESTAMPTZ", notNull: true },
    current_period_end: { type: "TIMESTAMPTZ", notNull: true },
    next_billing_date: { type: "TIMESTAMPTZ", notNull: true },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    updated_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("subscriptions", ["customer_id", "status"], { name: "idx_subscriptions_customer_status" });
  pgm.createIndex("subscriptions", ["status", "next_billing_date"], { name: "idx_subscriptions_next_billing" });
  pgm.createIndex("subscriptions", ["quotation_id"], { name: "idx_subscriptions_quotation_id" });

  // 3. Customer Credit Wallets
  pgm.createTable("customer_credit_wallets", {
    id: { type: "BIGSERIAL", primaryKey: true },
    customer_id: { type: "BIGINT", notNull: true, unique: true, references: "customers(id)" },
    balance: { type: "NUMERIC(18,4)", notNull: true, default: 0, check: "balance >= 0" },
    currency: { type: "VARCHAR(3)", notNull: true, references: "currencies(code)" },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    updated_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("customer_credit_wallets", ["customer_id"], { name: "idx_credit_wallets_customer" });

  // 4. Credit Transactions
  pgm.createTable("credit_transactions", {
    id: { type: "BIGSERIAL", primaryKey: true },
    wallet_id: { type: "BIGINT", notNull: true, references: "customer_credit_wallets(id)", onDelete: "CASCADE" },
    type: {
      type: "VARCHAR(30)",
      notNull: true,
      check: "type IN ('CANCELLATION_CREDIT', 'INVOICE_OFFSET', 'MANUAL_ADJUSTMENT', 'REFUND')",
    },
    amount: { type: "NUMERIC(18,4)", notNull: true },
    reference_type: { type: "VARCHAR(50)" },
    reference_id: { type: "BIGINT" },
    description: { type: "TEXT", notNull: true },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("credit_transactions", ["wallet_id", "created_at"], { name: "idx_credit_tx_wallet" });

  // 5. Subscription Changes
  pgm.createTable("subscription_changes", {
    id: { type: "BIGSERIAL", primaryKey: true },
    subscription_id: { type: "BIGINT", notNull: true, references: "subscriptions(id)", onDelete: "CASCADE" },
    change_type: {
      type: "VARCHAR(30)",
      notNull: true,
      check: "change_type IN ('PLAN_UPGRADE', 'PLAN_DOWNGRADE', 'QUANTITY_INCREASE', 'QUANTITY_DECREASE', 'CANCELLATION')",
    },
    old_plan_id: { type: "BIGINT", references: "subscription_plans(id)" },
    new_plan_id: { type: "BIGINT", references: "subscription_plans(id)" },
    old_quantity: { type: "INTEGER", notNull: true },
    new_quantity: { type: "INTEGER", notNull: true },
    effective_date: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    old_period_value: { type: "NUMERIC(18,4)", notNull: true },
    new_period_value: { type: "NUMERIC(18,4)", notNull: true },
    remaining_days: { type: "INTEGER", notNull: true },
    period_days: { type: "INTEGER", notNull: true },
    proration_amount: { type: "NUMERIC(18,4)", notNull: true },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("subscription_changes", ["subscription_id", "created_at"], { name: "idx_sub_changes_sub_created" });

  // 6. Billing Schedules
  pgm.createTable("billing_schedules", {
    id: { type: "BIGSERIAL", primaryKey: true },
    subscription_id: { type: "BIGINT", notNull: true, references: "subscriptions(id)", onDelete: "CASCADE" },
    billing_date: { type: "TIMESTAMPTZ", notNull: true },
    period_start: { type: "TIMESTAMPTZ", notNull: true },
    period_end: { type: "TIMESTAMPTZ", notNull: true },
    amount: { type: "NUMERIC(18,4)", notNull: true },
    status: {
      type: "VARCHAR(20)",
      notNull: true,
      default: "UPCOMING",
      check: "status IN ('UPCOMING', 'GENERATED', 'PAID', 'OVERDUE', 'CANCELLED')",
    },
    invoice_id: { type: "BIGINT" },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    updated_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("billing_schedules", ["subscription_id", "status"], { name: "idx_billing_schedules_sub_status" });
  pgm.createIndex("billing_schedules", ["status", "billing_date"], { name: "idx_billing_schedules_due" });

  // 7. Update invoices and invoice_payments table:
  pgm.dropConstraint("invoices", "invoices_quotation_id_key", { ifExists: true });
  pgm.alterColumn("invoices", "quotation_id", { notNull: false });
  pgm.dropConstraint("invoice_payments", "invoice_payments_payment_method_check", { ifExists: true });
  pgm.addConstraint("invoice_payments", "invoice_payments_payment_method_check", {
    check: "payment_method IN ('CASH', 'BANK_TRANSFER', 'CARD', 'CHECK', 'CREDIT_WALLET', 'OTHER')",
  });

  pgm.addColumns("invoices", {
    subscription_id: { type: "BIGINT", references: "subscriptions(id)" },
    invoice_type: {
      type: "VARCHAR(20)",
      notNull: true,
      default: "ONE_TIME",
      check: "invoice_type IN ('ONE_TIME', 'RECURRING', 'PRORATION')",
    },
    wallet_offset_amount: { type: "NUMERIC(18,4)", notNull: true, default: 0 },
  });

  pgm.addConstraint("billing_schedules", "fk_billing_schedules_invoice_id", {
    foreignKeys: {
      columns: "invoice_id",
      references: "invoices(id)",
      onDelete: "SET NULL",
    },
  });

  // 8. Update invoice_lines table:
  pgm.addColumns("invoice_lines", {
    subscription_id: { type: "BIGINT", references: "subscriptions(id)" },
    subscription_plan_id: { type: "BIGINT", references: "subscription_plans(id)" },
    billing_period_start: { type: "TIMESTAMPTZ" },
    billing_period_end: { type: "TIMESTAMPTZ" },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropConstraint("billing_schedules", "fk_billing_schedules_invoice_id", { ifExists: true });
  pgm.dropColumns("invoice_lines", ["subscription_id", "subscription_plan_id", "billing_period_start", "billing_period_end"]);
  pgm.dropColumns("invoices", ["subscription_id", "invoice_type", "wallet_offset_amount"]);
  pgm.alterColumn("invoices", "quotation_id", { null: false });
  pgm.addConstraint("invoices", "invoices_quotation_id_key", { unique: ["quotation_id"] });
  pgm.dropTable("billing_schedules");
  pgm.dropTable("subscription_changes");
  pgm.dropTable("credit_transactions");
  pgm.dropTable("customer_credit_wallets");
  pgm.dropTable("subscriptions");
  pgm.dropTable("subscription_plans");
}
