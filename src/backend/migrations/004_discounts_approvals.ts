import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Discount Rules: configure the maximum discount allowed per customer tier x product category.
  pgm.createTable(
    "discount_rules",
    {
      id: { type: "BIGSERIAL", primaryKey: true },
      customer_tier_id: { type: "BIGINT", notNull: true, references: "customer_tiers(id)" },
      category_id: { type: "BIGINT", notNull: true, references: "categories(id)" },
      max_discount_pct: { type: "NUMERIC(5,2)", notNull: true },
      is_active: { type: "BOOLEAN", notNull: true, default: true },
      created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
      updated_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    }
  );
  pgm.createIndex("discount_rules", ["customer_tier_id", "category_id"], {
    unique: true,
    where: "is_active = true",
    name: "uq_discount_rules_tier_category_active",
  });
  pgm.createIndex("discount_rules", ["category_id"], { name: "idx_discount_rules_category_id" });

  // Approval Rules: risk level -> ordered chain of role ids that must approve.
  pgm.createTable(
    "approval_rules",
    {
      id: { type: "BIGSERIAL", primaryKey: true },
      risk_level: {
        type: "VARCHAR(10)",
        notNull: true,
        check: "risk_level IN ('LOW', 'MEDIUM', 'HIGH')",
      },
      min_total_overage: { type: "NUMERIC(18,4)", notNull: true },
      role_sequence: { type: "INTEGER[]", notNull: true },
      is_active: { type: "BOOLEAN", notNull: true, default: true },
      created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
      updated_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    }
  );
  pgm.createIndex("approval_rules", ["risk_level", "is_active"], {
    name: "idx_approval_rules_risk_seq",
  });

  // Approval Requests: one workflow per quotation submission that requires review.
  pgm.createTable("approval_requests", {
    id: { type: "BIGSERIAL", primaryKey: true },
    quotation_id: { type: "BIGINT", notNull: true, references: "quotations(id)" },
    status: {
      type: "VARCHAR(20)",
      notNull: true,
      default: "PENDING_APPROVAL",
      check: "status IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED')",
    },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    risk_level: { type: "VARCHAR(10)", notNull: true },
    total_overage: { type: "NUMERIC(18,4)", notNull: true, default: 0 },
    submitted_by: { type: "BIGINT", notNull: true, references: "users(id)" },
    submitted_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    decided_by: { type: "BIGINT", references: "users(id)" },
    decided_at: { type: "TIMESTAMPTZ" },
    notes: { type: "TEXT" },
  });
  pgm.createIndex("approval_requests", ["quotation_id"], { name: "idx_approval_requests_quotation_id" });
  pgm.createIndex("approval_requests", ["status", "submitted_at"], {
    name: "idx_approval_requests_status_created",
    where: "status = 'PENDING_APPROVAL'",
  });

  // Approval Steps: the ordered per-role decisions within an approval request.
  pgm.createTable(
    "approval_steps",
    {
      id: { type: "BIGSERIAL", primaryKey: true },
      approval_request_id: { type: "BIGINT", notNull: true, references: "approval_requests(id)", onDelete: "CASCADE" },
      sequence: { type: "INTEGER", notNull: true },
      role_id: { type: "BIGINT", notNull: true, references: "roles(id)" },
      status: {
        type: "VARCHAR(10)",
        notNull: true,
        default: "PENDING",
        check: "status IN ('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED')",
      },
      decided_by: { type: "BIGINT", references: "users(id)" },
      decided_at: { type: "TIMESTAMPTZ" },
      notes: { type: "TEXT" },
    },
    {
      constraints: {
        unique: ["approval_request_id", "sequence"],
      },
    }
  );
  pgm.createIndex("approval_steps", ["approval_request_id"], { name: "idx_approval_steps_request_id" });

  // Audit Logs: append-only trace of every state-changing action.
  pgm.createTable("audit_logs", {
    id: { type: "BIGSERIAL", primaryKey: true },
    entity_type: { type: "VARCHAR(50)", notNull: true },
    entity_id: { type: "VARCHAR(50)", notNull: true },
    action: { type: "VARCHAR(50)", notNull: true },
    before: { type: "JSONB" },
    after: { type: "JSONB" },
    performed_by: { type: "BIGINT", references: "users(id)" },
    reason: { type: "TEXT" },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("audit_logs", ["entity_type", "entity_id"], { name: "idx_audit_logs_entity" });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("audit_logs");
  pgm.dropTable("approval_steps");
  pgm.dropTable("approval_requests");
  pgm.dropTable("approval_rules");
  pgm.dropTable("discount_rules");
}