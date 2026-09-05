import { query } from "../database/pool.js";
import { writeAuditLog } from "./audit.js";
import { NotFoundError } from "./errors.js";
import { calculateQuotation } from "../engines/quotation-engine.js";
import { evaluateDiscounts } from "../engines/discount-engine.js";
import { mapRiskLevel, selectRiskRule, buildSteps, RiskLevel } from "../engines/approval-engine.js";

// Shared quotation recalculation + approval machinery used by both the
// quotations module (Phase 3/4) and the negotiations module (Phase 6), so a
// negotiation-accepted discount reuses the exact same engine pipeline.

export async function fetchQuoteContext(quotationId: string | number): Promise<{ isNumeric: boolean; quote: any }> {
  const isNumeric = typeof quotationId === "number" || /^\d+$/.test(String(quotationId));
  const quoteResult = await query(
    `SELECT q.id, q.customer_id, q.currency_code, q.tax_rate_pct, q.order_discount_pct, q.status, c.tier_id as customer_tier_id
     FROM quotations q
     JOIN customers c ON q.customer_id = c.id
     WHERE ${isNumeric ? "q.id = $1" : "q.public_id::text = $1"}`,
    [quotationId]
  );

  if (quoteResult.rows.length === 0) {
    throw new NotFoundError("Quotation", quotationId);
  }

  return { isNumeric, quote: quoteResult.rows[0] };
}

export async function fetchLinesWithCategories(quotationId: number | string): Promise<any[]> {
  const linesResult = await query(
    `SELECT ql.id, ql.product_id, ql.product_variant_id, ql.description, ql.quantity,
            ql.unit_price, ql.unit_cost, ql.applied_discount_pct, ql.line_subtotal,
            p.category_id
     FROM quotation_lines ql
     JOIN products p ON ql.product_id = p.id
     WHERE ql.quotation_id = $1
     ORDER BY ql.id ASC`,
    [quotationId]
  );
  return linesResult.rows;
}

export async function fetchDiscountRules(tierId: number | string): Promise<any[]> {
  const result = await query(
    `SELECT id, customer_tier_id, category_id, max_discount_pct, is_active
     FROM discount_rules
     WHERE customer_tier_id = $1 AND is_active = true`,
    [tierId]
  );
  return result.rows;
}

export async function fetchApprovalRules(): Promise<any[]> {
  const result = await query(
    `SELECT id, risk_level, min_total_overage, role_sequence, is_active
     FROM approval_rules`
  );
  return result.rows;
}

// Recalculate and persist every monetary field on a quotation, including the
// Phase 4 discount overage and risk-level columns, then return the fresh state.
export async function recalculateAndPersistQuotation(quotationId: string | number): Promise<{
  header: any;
  total_overage: number;
  risk_level: RiskLevel;
  riskRule: any;
  discountEvaluation: ReturnType<typeof evaluateDiscounts>;
}> {
  const { quote } = await fetchQuoteContext(quotationId);
  const linesResult = await fetchLinesWithCategories(quote.id);
  const discountRules = await fetchDiscountRules(quote.customer_tier_id);
  const approvalRules = await fetchApprovalRules();

  const inputLines = linesResult.map((row) => ({
    id: Number(row.id),
    product_id: Number(row.product_id),
    product_variant_id: row.product_variant_id ? Number(row.product_variant_id) : null,
    description: row.description,
    quantity: Number(row.quantity),
    unit_price: Number(row.unit_price),
    unit_cost: Number(row.unit_cost),
    applied_discount_pct: Number(row.applied_discount_pct),
  }));

  const calc = calculateQuotation(
    inputLines,
    Number(quote.tax_rate_pct),
    Number(quote.order_discount_pct || 0)
  );

  const discountInputs = linesResult.map((row) => ({
    id: Number(row.id),
    product_id: Number(row.product_id),
    category_id: Number(row.category_id),
    line_subtotal: Number(row.line_subtotal),
    applied_discount_pct: Number(row.applied_discount_pct),
  }));
  const discountEvaluation = evaluateDiscounts(
    Number(quote.customer_tier_id),
    discountRules.map((r) => ({
      id: Number(r.id),
      customer_tier_id: Number(r.customer_tier_id),
      category_id: Number(r.category_id),
      max_discount_pct: Number(r.max_discount_pct),
      is_active: Boolean(r.is_active),
    })),
    discountInputs,
    Number(quote.order_discount_pct || 0)
  );

  const approvalRuleInputs = approvalRules.map((r) => ({
    id: Number(r.id),
    risk_level: r.risk_level as RiskLevel,
    min_total_overage: Number(r.min_total_overage),
    role_sequence: r.role_sequence.map(Number),
    is_active: Boolean(r.is_active),
  }));
  const total_overage = discountEvaluation.total_overage;
  const risk_level = mapRiskLevel(total_overage, approvalRuleInputs);
  const riskRule = selectRiskRule(total_overage, approvalRuleInputs);

  // Update lines in DB
  for (const line of calc.lines) {
    if (line.id) {
      await query(
        `UPDATE quotation_lines SET
           quantity = $1, unit_price = $2, unit_cost = $3,
           applied_discount_pct = $4, discount_amount = $5,
           line_subtotal = $6, line_total = $7, line_cost = $8,
           line_margin = $9, updated_at = NOW()
         WHERE id = $10`,
        [
          line.quantity,
          line.unit_price,
          line.unit_cost,
          line.applied_discount_pct,
          line.discount_amount,
          line.line_subtotal,
          line.line_total,
          line.line_cost,
          line.line_margin,
          line.id,
        ]
      );
    }
  }

  // Update header in DB
  const updateHeaderResult = await query(
    `UPDATE quotations SET
       subtotal = $1, discount_total = $2, order_discount_pct = $3, order_discount_amount = $4,
       tax_total = $5, grand_total = $6, total_cost = $7, margin_amount = $8, margin_pct = $9,
       total_overage = $10, risk_level = $11, updated_at = NOW()
     WHERE id = $12
     RETURNING *`,
    [
      calc.subtotal,
      calc.discount_total,
      calc.order_discount_pct,
      calc.order_discount_amount,
      calc.tax_total,
      calc.grand_total,
      calc.total_cost,
      calc.margin_amount,
      calc.margin_pct,
      total_overage,
      risk_level,
      quote.id,
    ]
  );

  return {
    header: updateHeaderResult.rows[0],
    total_overage,
    risk_level,
    riskRule,
    discountEvaluation,
  };
}

// Create an approval request and its ordered steps for a quotation.
export async function createApprovalRequest(ctx: {
  quotationId: number | string;
  risk_level: RiskLevel;
  total_overage: number;
  submittedBy: number;
  notes?: string;
  rule: any;
}): Promise<any> {
  const insertResult = await query(
    `INSERT INTO approval_requests (quotation_id, status, risk_level, total_overage, submitted_by, notes)
     VALUES ($1, 'PENDING_APPROVAL', $2, $3, $4, $5)
     RETURNING *`,
    [ctx.quotationId, ctx.risk_level, ctx.total_overage, ctx.submittedBy, ctx.notes ?? null]
  );
  const request = insertResult.rows[0];

  const steps = buildSteps(ctx.rule);
  for (const step of steps) {
    await query(
      `INSERT INTO approval_steps (approval_request_id, sequence, role_id)
       VALUES ($1, $2, $3)`,
      [request.id, step.sequence, step.role_id]
    );
  }

  await writeAuditLog({
    entityType: "approval_requests",
    entityId: request.id,
    action: "CREATED",
    before: null,
    after: {
      quotation_id: Number(request.quotation_id),
      risk_level: ctx.risk_level,
      total_overage: ctx.total_overage,
      role_sequence: steps.map((s) => s.role_id),
    },
    performedBy: ctx.submittedBy,
    reason: ctx.notes || `Auto-created ${ctx.risk_level} risk approval`,
  });

  return request;
}

export type RecalcResult = Awaited<ReturnType<typeof recalculateAndPersistQuotation>>;

// When a discount-affected edit lands on a quotation that is under review,
// supersede the open approval and re-issue one from the current risk.
export async function reopenApprovalAfterEdit(
  quotationId: number | string,
  userId: number,
  refreshed: RecalcResult
): Promise<void> {
  const openResult = await query(
    `SELECT id FROM approval_requests
     WHERE quotation_id = $1 AND status = 'PENDING_APPROVAL'`,
    [quotationId]
  );

  if (openResult.rows.length === 0) return;

  for (const req of openResult.rows) {
    await query(
      `UPDATE approval_requests SET
         status = 'CANCELLED', decided_by = $2, decided_at = NOW(),
         notes = 'Quote modified after submission; approval superseded'
       WHERE id = $1`,
      [req.id, userId]
    );
    await writeAuditLog({
      entityType: "approval_requests",
      entityId: req.id,
      action: "CANCELLED",
      before: { status: "PENDING_APPROVAL" },
      after: { status: "CANCELLED" },
      performedBy: userId,
      reason: "Quote modified after submission",
    });
  }

  const { risk_level, total_overage, riskRule } = refreshed;

  if (risk_level === "LOW") {
    await query(`UPDATE quotations SET status = 'APPROVED', updated_at = NOW() WHERE id = $1`, [quotationId]);
    await writeAuditLog({
      entityType: "quotations",
      entityId: quotationId,
      action: "APPROVED",
      before: { status: "PENDING_APPROVAL" },
      after: { status: "APPROVED" },
      performedBy: userId,
      reason: "Overage dropped below approval threshold after edit",
    });
    return;
  }

  await createApprovalRequest({
    quotationId,
    risk_level,
    total_overage,
    submittedBy: userId,
    notes: "Re-opened after quotation modification",
    rule: riskRule,
  });
  await query(`UPDATE quotations SET status = 'PENDING_APPROVAL', updated_at = NOW() WHERE id = $1`, [quotationId]);
  await writeAuditLog({
    entityType: "quotations",
    entityId: quotationId,
    action: "REOPENED",
    before: { status: "PENDING_APPROVAL" },
    after: { status: "PENDING_APPROVAL" },
    performedBy: userId,
    reason: "Auto re-opened approval after discount edit",
  });
}