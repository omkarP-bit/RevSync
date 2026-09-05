import { query } from "../database/pool.js";

export interface AuditEntry {
  entityType: string;
  entityId: string | number;
  action: string;
  before?: unknown;
  after?: unknown;
  performedBy?: number;
  reason?: string;
}

// Append-only audit trail for every state-changing action. Writes through to
// audit_logs with the full before/after payload so decisions stay explainable.
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  await query(
    `INSERT INTO audit_logs (entity_type, entity_id, action, before, after, performed_by, reason)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
    [
      entry.entityType,
      String(entry.entityId),
      entry.action,
      JSON.stringify(entry.before ?? null),
      JSON.stringify(entry.after ?? null),
      entry.performedBy ?? null,
      entry.reason ?? null,
    ]
  );
}