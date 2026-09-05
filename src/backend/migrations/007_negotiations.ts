import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Extend quotation statuses with PENDING_REAPPROVAL (negotiation-driven re-approval).
  pgm.dropConstraint("quotations", "quotations_status_check", { ifExists: true });
  pgm.addConstraint("quotations", "quotations_status_check", {
    check:
      "status IN ('DRAFT', 'PENDING_APPROVAL', 'PENDING_REAPPROVAL', 'APPROVED', 'REJECTED', 'NEGOTIATION', 'CONFIRMED', 'CANCELLED')",
  });

  // Negotiations: one open channel per quotation (customer <-> sales).
  pgm.createTable("negotiations", {
    id: { type: "BIGSERIAL", primaryKey: true },
    quotation_id: { type: "BIGINT", notNull: true, unique: true, references: "quotations(id)" },
    status: {
      type: "VARCHAR(10)",
      notNull: true,
      default: "OPEN",
      check: "status IN ('OPEN', 'CLOSED')",
    },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    updated_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("negotiations", ["quotation_id"], { name: "idx_negotiations_quotation_id" });
  pgm.createIndex("negotiations", "status", { where: "status = 'OPEN'", name: "idx_negotiations_open" });

  // Negotiation requests: counter-discount, delivery date, or terms requests.
  pgm.createTable(
    "negotiation_requests",
    {
      id: { type: "BIGSERIAL", primaryKey: true },
      negotiation_id: { type: "BIGINT", notNull: true, references: "negotiations(id)", onDelete: "CASCADE" },
      quotation_line_id: { type: "BIGINT", references: "quotation_lines(id)" },
      request_type: {
        type: "VARCHAR(20)",
        notNull: true,
        check: "request_type IN ('DISCOUNT', 'DELIVERY_DATE', 'TERMS')",
      },
      status: {
        type: "VARCHAR(12)",
        notNull: true,
        default: "PENDING",
        check: "status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'SUPERSEDED')",
      },
      original_value: { type: "VARCHAR(50)" },
      requested_value: { type: "VARCHAR(50)", notNull: true },
      requested_by_customer: { type: "BOOLEAN", notNull: true, default: true },
      requested_by: { type: "BIGINT", references: "users(id)" },
      resolved_by: { type: "BIGINT", references: "users(id)" },
      resolved_at: { type: "TIMESTAMPTZ" },
      message: { type: "TEXT" },
      created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
    },
    {
      constraints: {
        check: "request_type <> 'DISCOUNT' OR quotation_line_id IS NOT NULL",
      },
    }
  );
  pgm.createIndex("negotiation_requests", ["negotiation_id", "created_at"], {
    name: "idx_negotiation_requests_negotiation_id",
  });

  // Negotiation messages: ordered chat between customer and sales.
  pgm.createTable("negotiation_messages", {
    id: { type: "BIGSERIAL", primaryKey: true },
    negotiation_id: { type: "BIGINT", notNull: true, references: "negotiations(id)", onDelete: "CASCADE" },
    sender_type: {
      type: "VARCHAR(10)",
      notNull: true,
      check: "sender_type IN ('CUSTOMER', 'SALES')",
    },
    sender_user_id: { type: "BIGINT", references: "users(id)" },
    body: { type: "TEXT", notNull: true },
    created_at: { type: "TIMESTAMPTZ", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("negotiation_messages", ["negotiation_id", "created_at"], {
    name: "idx_negotiation_messages_negotiation_id",
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("negotiation_messages");
  pgm.dropTable("negotiation_requests");
  pgm.dropTable("negotiations");
  pgm.dropConstraint("quotations", "quotations_status_check", { ifExists: true });
  pgm.addConstraint("quotations", "quotations_status_check", {
    check:
      "status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'NEGOTIATION', 'CONFIRMED', 'CANCELLED')",
  });
}