import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createIndex("audit_logs", ["entity_type", "entity_id", "created_at"], {
    name: "idx_audit_logs_timeline",
    ifNotExists: true,
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex("audit_logs", ["entity_type", "entity_id", "created_at"], {
    name: "idx_audit_logs_timeline",
  });
}
