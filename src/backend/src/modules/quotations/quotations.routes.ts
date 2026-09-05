import { Router, Request, Response, NextFunction } from "express";
import { query } from "../../database/pool.js";
import { authenticate, requireRole, ROLES } from "../../middleware/auth.js";
import { NotFoundError, ValidationError, UnprocessableEntityError } from "../../shared/errors.js";
import { writeAuditLog } from "../../shared/audit.js";
import { calculateQuotation } from "../../engines/quotation-engine.js";
import { evaluateDiscounts } from "../../engines/discount-engine.js";
import { resolveUnitPrice } from "../../engines/pricing-engine.js";
import { mapRiskLevel, selectRiskRule, buildSteps, RiskLevel } from "../../engines/approval-engine.js";
import { z } from "zod";

export const quotationsRouter = Router();
quotationsRouter.use(authenticate);

const createQuotationSchema = z.object({
  customer_id: z.coerce.number().int().positive(),
  tax_rate_pct: z.coerce.number().nonnegative().default(10.0),
  notes: z.string().optional(),
});

const patchQuotationSchema = z.object({
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "NEGOTIATION", "CONFIRMED", "CANCELLED"]).optional(),
  tax_rate_pct: z.coerce.number().nonnegative().optional(),
  notes: z.string().optional(),
});

const addLineSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  product_variant_id: z.coerce.number().int().positive().nullable().optional(),
  description: z.string().optional(),
  quantity: z.coerce.number().int().positive().default(1),
  applied_discount_pct: z.coerce.number().min(0).max(100).default(0),
});

const patchLineSchema = z.object({
  quantity: z.coerce.number().int().positive().optional(),
  applied_discount_pct: z.coerce.number().min(0).max(100).optional(),
  description: z.string().optional(),
});

const submitSchema = z.object({
  notes: z.string().optional(),
});

async function fetchQuoteContext(quotationId: string | number): Promise<{ isNumeric: boolean; quote: any }> {
  const isNumeric = typeof quotationId === "number" || /^\d+$/.test(String(quotationId));
  const quoteResult = await query(
    `SELECT q.id, q.customer_id, q.currency_code, q.tax_rate_pct, q.status, c.tier_id as customer_tier_id
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

async function fetchLinesWithCategories(quotationId: number | string): Promise<any[]> {
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

async function fetchDiscountRules(tierId: number | string): Promise<any[]> {
  const result = await query(
    `SELECT id, customer_tier_id, category_id, max_discount_pct, is_active
     FROM discount_rules
     WHERE customer_tier_id = $1 AND is_active = true`,
    [tierId]
  );
  return result.rows;
}

async function fetchApprovalRules(): Promise<any[]> {
  const result = await query(
    `SELECT id, risk_level, min_total_overage, role_sequence, is_active
     FROM approval_rules`
  );
  return result.rows;
}

// Recalculate and persist every monetary field on a quotation, including the
// Phase 4 discount overage and risk-level columns, then return the fresh state.
async function recalculateAndPersistQuotation(quotationId: string | number): Promise<{
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

  const calc = calculateQuotation(inputLines, Number(quote.tax_rate_pct));

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
    discountInputs
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
       subtotal = $1, discount_total = $2, tax_total = $3, grand_total = $4,
       total_cost = $5, margin_amount = $6, margin_pct = $7,
       total_overage = $8, risk_level = $9, updated_at = NOW()
     WHERE id = $10
     RETURNING *`,
    [
      calc.subtotal,
      calc.discount_total,
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
async function createApprovalRequest(ctx: {
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

type RecalcResult = Awaited<ReturnType<typeof recalculateAndPersistQuotation>>;

// When a discount-affected edit lands on a quotation that is under review,
// supersede the open approval and re-issue one from the current risk.
async function reopenApprovalAfterEdit(
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

function serializeHeader(row: any) {
  return {
    ...row,
    id: Number(row.id),
    customer_id: Number(row.customer_id),
    sales_rep_id: Number(row.sales_rep_id),
    subtotal: Number(row.subtotal),
    discount_total: Number(row.discount_total),
    tax_rate_pct: Number(row.tax_rate_pct),
    tax_total: Number(row.tax_total),
    grand_total: Number(row.grand_total),
    total_cost: Number(row.total_cost),
    margin_amount: Number(row.margin_amount),
    margin_pct: Number(row.margin_pct),
    total_overage: Number(row.total_overage),
  };
}

// GET /api/v1/quotations
quotationsRouter.get("/", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER, ROLES.FINANCE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (req.query.status) {
      where.push(`q.status = $${paramIdx++}`);
      params.push(req.query.status);
    }
    if (req.query.customer_id) {
      where.push(`q.customer_id = $${paramIdx++}`);
      params.push(parseInt(req.query.customer_id as string));
    }
    if (req.query.sales_rep_id) {
      where.push(`q.sales_rep_id = $${paramIdx++}`);
      params.push(parseInt(req.query.sales_rep_id as string));
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const countResult = await query(`SELECT COUNT(*) FROM quotations q ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT q.id, q.quotation_number, q.public_id, q.customer_id, c.name as customer_name,
              q.sales_rep_id, u.first_name || ' ' || u.last_name as sales_rep_name,
              q.currency_code, q.status, q.subtotal, q.discount_total, q.tax_rate_pct,
              q.tax_total, q.grand_total, q.margin_amount, q.margin_pct, q.risk_level,
              q.total_overage, q.created_at, q.updated_at
       FROM quotations q
       JOIN customers c ON q.customer_id = c.id
       JOIN users u ON q.sales_rep_id = u.id
       ${whereClause}
       ORDER BY q.status ASC, q.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    res.json({
      data: result.rows.map((row) => serializeHeader(row)),
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

async function getFullQuotationPayload(quotationId: string | number) {
  const isNumeric = typeof quotationId === "number" || /^\d+$/.test(String(quotationId));

  const quoteResult = await query(
    `SELECT q.id, q.quotation_number, q.public_id, q.customer_id, c.name as customer_name,
            c.tier_id as customer_tier_id, ct.name as tier_name,
            q.sales_rep_id, u.first_name || ' ' || u.last_name as sales_rep_name,
            q.currency_code, q.status, q.subtotal, q.discount_total, q.tax_rate_pct,
            q.tax_total, q.grand_total, q.total_cost, q.margin_amount, q.margin_pct,
            q.total_overage, q.risk_level, q.notes, q.created_at, q.updated_at
     FROM quotations q
     JOIN customers c ON q.customer_id = c.id
     JOIN customer_tiers ct ON c.tier_id = ct.id
     JOIN users u ON q.sales_rep_id = u.id
     WHERE ${isNumeric ? "q.id = $1" : "q.public_id::text = $1"}`,
    [quotationId]
  );

  if (quoteResult.rows.length === 0) {
    throw new NotFoundError("Quotation", quotationId);
  }

  const quote = quoteResult.rows[0];

  const linesResult = await query(
    `SELECT ql.id, ql.quotation_id, ql.product_id, p.name as product_name, p.sku as product_sku,
            p.category_id, ql.product_variant_id, pv.name as variant_name, ql.description, ql.quantity,
            ql.unit_price, ql.unit_cost, ql.applied_discount_pct, ql.discount_amount,
            ql.line_subtotal, ql.line_total, ql.line_cost, ql.line_margin,
            ql.created_at, ql.updated_at
     FROM quotation_lines ql
     JOIN products p ON ql.product_id = p.id
     LEFT JOIN product_variants pv ON ql.product_variant_id = pv.id
     WHERE ql.quotation_id = $1
     ORDER BY ql.id ASC`,
    [quote.id]
  );

  const discountRules = await fetchDiscountRules(quote.customer_tier_id);
  const discountEvaluation = evaluateDiscounts(
    Number(quote.customer_tier_id),
    discountRules.map((r) => ({
      id: Number(r.id),
      customer_tier_id: Number(r.customer_tier_id),
      category_id: Number(r.category_id),
      max_discount_pct: Number(r.max_discount_pct),
      is_active: Boolean(r.is_active),
    })),
    linesResult.rows.map((l) => ({
      id: Number(l.id),
      product_id: Number(l.product_id),
      category_id: Number(l.category_id),
      line_subtotal: Number(l.line_subtotal),
      applied_discount_pct: Number(l.applied_discount_pct),
    }))
  );

  return {
    ...serializeHeader(quote),
    discount_analysis: {
      ...discountEvaluation,
      lines: discountEvaluation.lines.map((l) => ({
        id: l.id ?? null,
        product_id: l.product_id,
        product_name: linesResult.rows.find((r) => Number(r.id) === Number(l.id))?.product_name ?? null,
        category_id: l.category_id,
        applied_discount_pct: l.applied_discount_pct,
        allowed_discount_pct: l.allowed_discount_pct,
        line_overage: l.line_overage,
        is_flagged: l.is_flagged,
        reason: l.reason,
      })),
    },
    lines: linesResult.rows.map((l) => ({
      ...l,
      id: Number(l.id),
      quotation_id: Number(l.quotation_id),
      product_id: Number(l.product_id),
      category_id: Number(l.category_id),
      product_variant_id: l.product_variant_id ? Number(l.product_variant_id) : null,
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
      unit_cost: Number(l.unit_cost),
      applied_discount_pct: Number(l.applied_discount_pct),
      discount_amount: Number(l.discount_amount),
      line_subtotal: Number(l.line_subtotal),
      line_total: Number(l.line_total),
      line_cost: Number(l.line_cost),
      line_margin: Number(l.line_margin),
    })),
  };
}

// GET /api/v1/quotations/:id
quotationsRouter.get("/:id", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER, ROLES.FINANCE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const data = await getFullQuotationPayload(id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/quotations
quotationsRouter.post("/", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const data = createQuotationSchema.parse(req.body);

    // Resolve customer's tier & currency
    const customerResult = await query(
      `SELECT id, currency_code FROM customers WHERE id = $1`,
      [data.customer_id]
    );

    if (customerResult.rows.length === 0) {
      throw new NotFoundError("Customer", data.customer_id);
    }

    const customer = customerResult.rows[0];

    // Generate unique quote number: QT-YYYY-XXXX
    const year = new Date().getFullYear();
    const countResult = await query(`SELECT COUNT(*) FROM quotations`);
    const nextSeq = parseInt(countResult.rows[0].count) + 1;
    const quotationNumber = `QT-${year}-${String(nextSeq).padStart(4, "0")}`;

    const insertResult = await query(
      `INSERT INTO quotations (quotation_number, customer_id, sales_rep_id, currency_code, tax_rate_pct, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [quotationNumber, data.customer_id, userId, customer.currency_code, data.tax_rate_pct, data.notes || null]
    );

    await writeAuditLog({
      entityType: "quotations",
      entityId: insertResult.rows[0].id,
      action: "CREATED",
      before: null,
      after: { quotation_number: quotationNumber, customer_id: data.customer_id, status: "DRAFT" },
      performedBy: userId,
      reason: "Quotation created",
    });

    const row = insertResult.rows[0];
    res.status(201).json({
      data: {
        ...serializeHeader(row),
        lines: [],
      },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/quotations/:id
quotationsRouter.patch("/:id", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.userId;
    const fields = patchQuotationSchema.parse(req.body);

    const { quote } = await fetchQuoteContext(id);
    const realId = quote.id;

    if (fields.status) {
      const targetStatus = fields.status;
      const forbiddenDirect = ["PENDING_APPROVAL", "APPROVED", "REJECTED"];
      if (forbiddenDirect.includes(targetStatus)) {
        throw new UnprocessableEntityError(
          `'${targetStatus}' must be reached through the submit/approval workflow`
        );
      }

      if (targetStatus === "CONFIRMED") {
        if (quote.status !== "APPROVED") {
          throw new UnprocessableEntityError("Only APPROVED quotations can be confirmed");
        }
        const openApproval = await query(
          `SELECT id FROM approval_requests WHERE quotation_id = $1 AND status = 'PENDING_APPROVAL'`,
          [realId]
        );
        if (openApproval.rows.length > 0) {
          throw new UnprocessableEntityError("Approval is still pending for this quotation");
        }
      }

      if ((targetStatus === "DRAFT" || targetStatus === "NEGOTIATION") && quote.status === "PENDING_APPROVAL") {
        const openApproval = await query(
          `SELECT id FROM approval_requests WHERE quotation_id = $1 AND status = 'PENDING_APPROVAL'`,
          [realId]
        );
        for (const req of openApproval.rows) {
          await query(
            `UPDATE approval_requests SET
               status = 'CANCELLED', decided_by = $2, decided_at = NOW(),
               notes = 'Retracted by creator'
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
            reason: "Quotation retracted from approval",
          });
        }
      }

      await query(
        `UPDATE quotations SET status = $1, updated_at = NOW() WHERE id = $2`,
        [targetStatus, realId]
      );
      await writeAuditLog({
        entityType: "quotations",
        entityId: realId,
        action: targetStatus,
        before: { status: quote.status },
        after: { status: targetStatus },
        performedBy: userId,
        reason: "Manual status update",
      });
    }

    const entries = Object.entries(fields).filter(([k, v]) => v !== undefined && k !== "status");
    if (entries.length > 0) {
      const setClauses = entries.map(([k], i) => `${k} = $${i + 1}`);
      const values = entries.map(([, v]) => v);
      await query(
        `UPDATE quotations SET ${setClauses.join(", ")}, updated_at = NOW() WHERE id = $${entries.length + 1}`,
        [...values, realId]
      );
    }

    const refreshed = await recalculateAndPersistQuotation(realId);
    res.json({ data: serializeHeader(refreshed.header) });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/quotations/:id/submit
quotationsRouter.post("/:id/submit", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.userId;
    const { notes } = submitSchema.parse(req.body ?? {});

    const refreshed = await recalculateAndPersistQuotation(id);
    const { header, total_overage, risk_level, riskRule } = refreshed;
    const quoteId = header.id;
    const currentStatus = header.status;

    if (currentStatus !== "DRAFT" && currentStatus !== "NEGOTIATION") {
      throw new UnprocessableEntityError("Only DRAFT or NEGOTIATION quotations can be submitted for approval");
    }

    if (risk_level === "LOW") {
      await query(`UPDATE quotations SET status = 'APPROVED', updated_at = NOW() WHERE id = $1`, [quoteId]);
      await writeAuditLog({
        entityType: "quotations",
        entityId: quoteId,
        action: "APPROVED",
        before: { status: currentStatus },
        after: { status: "APPROVED", total_overage, risk_level },
        performedBy: userId,
        reason: notes || "No approval required (LOW risk)",
      });
    } else {
      await createApprovalRequest({
        quotationId: quoteId,
        risk_level,
        total_overage,
        submittedBy: userId,
        notes,
        rule: riskRule,
      });
      await query(`UPDATE quotations SET status = 'PENDING_APPROVAL', updated_at = NOW() WHERE id = $1`, [quoteId]);
      await writeAuditLog({
        entityType: "quotations",
        entityId: quoteId,
        action: "SUBMITTED",
        before: { status: currentStatus },
        after: { status: "PENDING_APPROVAL", total_overage, risk_level },
        performedBy: userId,
        reason: notes || "Submitted for approval",
      });
    }

    const finalResult = await query(`SELECT * FROM quotations WHERE id = $1`, [quoteId]);
    res.json({ data: serializeHeader(finalResult.rows[0]) });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/quotations/:id/lines
quotationsRouter.post("/:id/lines", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.userId;
    const isNumeric = /^\d+$/.test(id);
    const data = addLineSchema.parse(req.body);

    // Fetch quote detail for customer tier & currency
    const quoteResult = await query(
      `SELECT q.id, q.currency_code, c.tier_id as customer_tier_id
       FROM quotations q
       JOIN customers c ON q.customer_id = c.id
       WHERE ${isNumeric ? "q.id = $1" : "q.public_id::text = $1"}`,
      [id]
    );

    if (quoteResult.rows.length === 0) {
      throw new NotFoundError("Quotation", id);
    }

    const quote = quoteResult.rows[0];

    // Fetch product details & base cost
    const productResult = await query(
      `SELECT id, name, base_cost FROM products WHERE id = $1`,
      [data.product_id]
    );

    if (productResult.rows.length === 0) {
      throw new NotFoundError("Product", data.product_id);
    }

    const product = productResult.rows[0];
    const unitCost = Number(product.base_cost);

    // Resolve snapshot unit_price from Tier x Currency price list
    const priceListEntries = await query(
      `SELECT pli.price_list_id, pl.name as price_list_name, pl.customer_tier_id,
              pl.currency_code, pli.product_id, pli.unit_price
       FROM price_list_items pli
       JOIN price_lists pl ON pli.price_list_id = pl.id
       WHERE pli.product_id = $1 AND pl.customer_tier_id = $2 AND pl.currency_code = $3 AND pl.is_active = true`,
      [data.product_id, quote.customer_tier_id, quote.currency_code]
    );

    let unitPrice = unitCost * 1.3; // Fallback 30% markup if no price list item
    if (priceListEntries.rows.length > 0) {
      const match = resolveUnitPrice(
        priceListEntries.rows,
        data.product_id,
        quote.customer_tier_id,
        quote.currency_code
      );
      if (match.unitPrice !== null) {
        unitPrice = match.unitPrice;
      }
    }

    // Temporary calculations
    const qty = data.quantity;
    const discPct = data.applied_discount_pct;
    const subtotal = qty * unitPrice;
    const discAmt = subtotal * (discPct / 100);
    const lineTotal = subtotal - discAmt;
    const lineCost = qty * unitCost;
    const lineMargin = lineTotal - lineCost;

    const insertResult = await query(
      `INSERT INTO quotation_lines
         (quotation_id, product_id, product_variant_id, description, quantity,
          unit_price, unit_cost, applied_discount_pct, discount_amount,
          line_subtotal, line_total, line_cost, line_margin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        quote.id,
        data.product_id,
        data.product_variant_id || null,
        data.description || product.name,
        qty,
        unitPrice,
        unitCost,
        discPct,
        discAmt,
        subtotal,
        lineTotal,
        lineCost,
        lineMargin,
      ]
    );

    await writeAuditLog({
      entityType: "quotation_lines",
      entityId: insertResult.rows[0].id,
      action: "LINE_ADDED",
      before: null,
      after: { product_id: data.product_id, quantity: qty, applied_discount_pct: discPct },
      performedBy: userId,
      reason: "Line added",
    });

    const refreshed = await recalculateAndPersistQuotation(quote.id);
    if (refreshed.header.status === "PENDING_APPROVAL") {
      await reopenApprovalAfterEdit(quote.id, userId, refreshed);
    }
    const fullPayload = await getFullQuotationPayload(quote.id);
    res.status(201).json({ data: fullPayload });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/quotations/:id/lines/:lineId
quotationsRouter.patch("/:id/lines/:lineId", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, lineId } = req.params;
    const userId = (req as any).user.userId;
    const fields = patchLineSchema.parse(req.body);

    const lineCheck = await query(
      `SELECT id FROM quotation_lines WHERE id = $1 AND quotation_id = $2`,
      [lineId, id]
    );

    if (lineCheck.rows.length === 0) {
      throw new NotFoundError("QuotationLine", lineId);
    }

    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length > 0) {
      const setClauses = entries.map(([k], i) => `${k} = $${i + 1}`);
      const values = entries.map(([, v]) => v);

      await query(
        `UPDATE quotation_lines SET ${setClauses.join(", ")}, updated_at = NOW() WHERE id = $${entries.length + 1}`,
        [...values, lineId]
      );
    }

    await writeAuditLog({
      entityType: "quotation_lines",
      entityId: lineId,
      action: "LINE_UPDATED",
      before: null,
      after: fields,
      performedBy: userId,
      reason: "Line updated",
    });

    const refreshed = await recalculateAndPersistQuotation(id);
    if (refreshed.header.status === "PENDING_APPROVAL") {
      await reopenApprovalAfterEdit(id, userId, refreshed);
    }
    const fullPayload = await getFullQuotationPayload(id);
    res.json({ data: fullPayload });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/quotations/:id/lines/:lineId
quotationsRouter.delete("/:id/lines/:lineId", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, lineId } = req.params;
    const userId = (req as any).user.userId;

    const result = await query(
      `DELETE FROM quotation_lines WHERE id = $1 AND quotation_id = $2 RETURNING id`,
      [lineId, id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("QuotationLine", lineId);
    }

    await writeAuditLog({
      entityType: "quotation_lines",
      entityId: lineId,
      action: "LINE_DELETED",
      before: null,
      after: null,
      performedBy: userId,
      reason: "Line removed",
    });

    const refreshed = await recalculateAndPersistQuotation(id);
    if (refreshed.header.status === "PENDING_APPROVAL") {
      await reopenApprovalAfterEdit(id, userId, refreshed);
    }
    const fullPayload = await getFullQuotationPayload(id);
    res.json({ data: fullPayload });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/quotations/:id/recalculate
quotationsRouter.post("/:id/recalculate", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    await recalculateAndPersistQuotation(id);
    const fullPayload = await getFullQuotationPayload(id);
    res.json({ data: fullPayload });
  } catch (err) {
    next(err);
  }
});