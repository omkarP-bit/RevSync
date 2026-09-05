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

export interface FinancialSnapshot {
  subtotal: number;
  discount_total: number;
  order_discount_pct: number;
  order_discount_amount: number;
  tax_rate_pct: number;
  tax_total: number;
  grand_total: number;
  total_cost: number;
  margin_amount: number;
  margin_pct: number;
  total_overage: number;
  risk_level: string;
  currency_code: string;
}

export interface LineSnapshot {
  id?: number;
  product_id: number;
  product_sku?: string;
  product_name?: string;
  product_variant_id?: number | null;
  description?: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  applied_discount_pct: number;
  discount_amount: number;
  line_subtotal: number;
  line_total: number;
  line_cost: number;
  line_margin: number;
}

export function extractFinancialSnapshot(q: any): FinancialSnapshot {
  return {
    subtotal: Number(q.subtotal || 0),
    discount_total: Number(q.discount_total || 0),
    order_discount_pct: Number(q.order_discount_pct || 0),
    order_discount_amount: Number(q.order_discount_amount || 0),
    tax_rate_pct: Number(q.tax_rate_pct || 0),
    tax_total: Number(q.tax_total || 0),
    grand_total: Number(q.grand_total || 0),
    total_cost: Number(q.total_cost || 0),
    margin_amount: Number(q.margin_amount || 0),
    margin_pct: Number(q.margin_pct || 0),
    total_overage: Number(q.total_overage || 0),
    risk_level: String(q.risk_level || "LOW"),
    currency_code: String(q.currency_code || "USD"),
  };
}

export function extractLineSnapshot(l: any): LineSnapshot {
  return {
    id: l.id ? Number(l.id) : undefined,
    product_id: Number(l.product_id),
    product_sku: l.product_sku || l.sku || undefined,
    product_name: l.product_name || l.name || undefined,
    product_variant_id: l.product_variant_id ? Number(l.product_variant_id) : null,
    description: l.description || undefined,
    quantity: Number(l.quantity || 0),
    unit_price: Number(l.unit_price || 0),
    unit_cost: Number(l.unit_cost || 0),
    applied_discount_pct: Number(l.applied_discount_pct || 0),
    discount_amount: Number(l.discount_amount || 0),
    line_subtotal: Number(l.line_subtotal || 0),
    line_total: Number(l.line_total || 0),
    line_cost: Number(l.line_cost || 0),
    line_margin: Number(l.line_margin || 0),
  };
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