import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn("customers", {
    password_hash: { type: "VARCHAR(255)" },
    setup_token_hash: { type: "VARCHAR(255)" },
    setup_token_expires_at: { type: "TIMESTAMPTZ" },
  }, { ifNotExists: true });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn("customers", [
    "password_hash",
    "setup_token_hash",
    "setup_token_expires_at",
  ]);
}
