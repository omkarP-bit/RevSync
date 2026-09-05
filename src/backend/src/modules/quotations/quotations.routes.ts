import { Router, Request, Response, NextFunction } from "express";
import { query, withTransaction } from "../../database/pool.js";
import { authenticate, requireRole, ROLES } from "../../middleware/auth.js";
import { NotFoundError, ValidationError, UnprocessableEntityError, ConflictError, ForbiddenError } from "../../shared/errors.js";
import { writeAuditLog, extractFinancialSnapshot, extractLineSnapshot } from "../../shared/audit.js";
import { createSubscriptionsForQuotation } from "../../engines/subscription-engine.js";
import { createFulfillmentForQuotation } from "../fulfillment/fulfillment-service.js";

function assertQuotationNotConfirmed(status: string): void {
  if (status === "CONFIRMED") {
    throw new ConflictError("Confirmed quotations are locked and cannot be modified.");
  }
}

async function handleCommercialMutationOnApproved(
  quotationId: number | string,
  currentStatus: string,
  userId: number,
  reasonDetail: string
): Promise<void> {
  if (currentStatus === "APPROVED") {
    await withTransaction(async (client) => {
      await client.query(`UPDATE quotations SET status = 'NEGOTIATION', updated_at = NOW() WHERE id = $1`, [quotationId]);
      const openApproval = await client.query(
        `SELECT id FROM approval_requests WHERE quotation_id = $1 AND status = 'PENDING_APPROVAL'`,
        [quotationId]
      );
      for (const req of openApproval.rows) {
        await client.query(
          `UPDATE approval_requests SET status = 'CANCELLED', decided_by = $2, decided_at = NOW(), notes = $3 WHERE id = $1`,
          [req.id, userId, `Commercial modification (${reasonDetail}); approval superseded`]
        );
        await writeAuditLog({
          entityType: "approval_requests",
          entityId: req.id,
          action: "CANCELLED",
          before: { status: "PENDING_APPROVAL" },
          after: { status: "CANCELLED" },
          performedBy: userId,
          reason: `Approval invalidated due to commercial change (${reasonDetail})`,
        });
      }
      await writeAuditLog({
        entityType: "quotations",
        entityId: quotationId,
        action: "NEGOTIATION",
        before: { status: "APPROVED" },
        after: { status: "NEGOTIATION" },
        performedBy: userId,
        reason: `Commercial modification (${reasonDetail}) invalidated APPROVED status`,
      });
    });
  }
}
import { calculateQuotation } from "../../engines/quotation-engine.js";
import { evaluateDiscounts } from "../../engines/discount-engine.js";
import { resolveUnitPrice } from "../../engines/pricing-engine.js";
import {
  fetchQuoteContext,
  fetchLinesWithCategories,
  fetchDiscountRules,
  fetchApprovalRules,
  recalculateAndPersistQuotation,
  createApprovalRequest,
  reopenApprovalAfterEdit,
  executeQuotationConfirmation,
  RecalcResult,
} from "../../shared/quote-workflow.js";
import { z } from "zod";

export const quotationsRouter = Router();
quotationsRouter.use(authenticate);

const createQuotationSchema = z.object({
  customer_id: z.coerce.number().int().positive(),
  tax_rate_pct: z.coerce.number().nonnegative().default(10.0),
  notes: z.string().optional(),
});

const patchQuotationSchema = z.object({
  customer_id: z.coerce.number().int().positive().optional(),
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "NEGOTIATION", "CONFIRMED", "CANCELLED"]).optional(),
  tax_rate_pct: z.coerce.number().nonnegative().optional(),
  order_discount_pct: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().optional(),
  reason: z.string().optional(),
});

const addLineSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  product_variant_id: z.coerce.number().int().positive().nullable().optional(),
  description: z.string().optional(),
  quantity: z.coerce.number().int().positive().default(1),
  applied_discount_pct: z.coerce.number().min(0).max(100).default(0),
  reason: z.string().optional(),
});

const patchLineSchema = z.object({
  quantity: z.coerce.number().int().positive().optional(),
  applied_discount_pct: z.coerce.number().min(0).max(100).optional(),
  unit_price: z.coerce.number().nonnegative().optional(),
  product_variant_id: z.coerce.number().int().positive().nullable().optional(),
  description: z.string().optional(),
  reason: z.string().optional(),
});

const submitSchema = z.object({
  notes: z.string().optional(),
});

function serializeHeader(row: any) {
  return {
    ...row,
    id: Number(row.id),
    customer_id: Number(row.customer_id),
    sales_rep_id: Number(row.sales_rep_id),
    subtotal: Number(row.subtotal),
    discount_total: Number(row.discount_total),
    order_discount_pct: Number(row.order_discount_pct || 0),
    order_discount_amount: Number(row.order_discount_amount || 0),
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
            q.currency_code, q.status, q.subtotal, q.discount_total, q.order_discount_pct,
            q.order_discount_amount, q.tax_rate_pct, q.tax_total, q.grand_total, q.total_cost,
            q.margin_amount, q.margin_pct, q.total_overage, q.risk_level, q.notes,
            q.created_at, q.updated_at
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
            p.category_id, p.product_type, ql.product_variant_id, pv.name as variant_name, ql.description, ql.quantity,
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
    })),
    Number(quote.order_discount_pct || 0)
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

    const row = insertResult.rows[0];
    const initialSnapshot = extractFinancialSnapshot(row);

    await writeAuditLog({
      entityType: "quotations",
      entityId: row.id,
      action: "CREATED",
      before: null,
      after: {
        quotation_number: quotationNumber,
        customer_id: data.customer_id,
        status: "DRAFT",
        header: initialSnapshot,
      },
      performedBy: userId,
      reason: "Quotation created",
    });
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

    assertQuotationNotConfirmed(quote.status);

    const commercialKeys = ["customer_id", "tax_rate_pct", "order_discount_pct"];
    const isCommercialUpdate = Object.keys(fields).some((k) => commercialKeys.includes(k));
    if (isCommercialUpdate) {
      const detail = Object.keys(fields).filter((k) => commercialKeys.includes(k)).join(", ");
      await handleCommercialMutationOnApproved(realId, quote.status, userId, detail);
    }

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
        if (!quote.payment_terms) {
          throw new UnprocessableEntityError(
            "Customer has no payment type selected; please set payment terms before confirming"
          );
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

      if (targetStatus === "CONFIRMED") {
        await withTransaction(async (client) => {
          await client.query(
            `UPDATE quotations SET status = $1, updated_at = NOW() WHERE id = $2`,
            [targetStatus, realId]
          );
          await createSubscriptionsForQuotation(client, realId, userId);
          await createFulfillmentForQuotation(client, realId, userId, { skipIfNotFulfillable: true });
          await writeAuditLog({
            entityType: "quotations",
            entityId: realId,
            action: targetStatus,
            before: { status: quote.status },
            after: {
              status: targetStatus,
              payment_terms: quote.payment_terms,
              fulfillment: "AUTO_CREATED",
            },
            performedBy: userId,
            reason: "Quotation confirmed; subscriptions & billing schedules initialized and stock allocated",
          });
        });
      } else {
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
    }

    const oldHeaderSnapshot = extractFinancialSnapshot(quote);

    if (fields.customer_id && fields.customer_id !== quote.customer_id) {
      await writeAuditLog({
        entityType: "quotations",
        entityId: realId,
        action: "CUSTOMER_CHANGED",
        before: { customer_id: quote.customer_id, header: oldHeaderSnapshot },
        after: { customer_id: fields.customer_id },
        performedBy: userId,
        reason: fields.reason || "Customer changed",
      });
    }

    if (fields.customer_id) {
      const custRes = await query(`SELECT currency_code FROM customers WHERE id = $1`, [fields.customer_id]);
      if (custRes.rows.length > 0 && custRes.rows[0].currency_code !== quote.currency_code) {
        const oldCurr = quote.currency_code;
        await query(`UPDATE quotations SET currency_code = $1 WHERE id = $2`, [custRes.rows[0].currency_code, realId]);
        await writeAuditLog({
          entityType: "quotations",
          entityId: realId,
          action: "CURRENCY_CHANGED",
          before: { currency_code: oldCurr, header: oldHeaderSnapshot },
          after: { currency_code: custRes.rows[0].currency_code },
          performedBy: userId,
          reason: fields.reason || "Currency updated to match customer default",
        });
      }
    }

    const entries = Object.entries(fields).filter(([k, v]) => v !== undefined && k !== "status" && k !== "reason");
    if (entries.length > 0) {
      const setClauses = entries.map(([k], i) => `${k} = $${i + 1}`);
      const values = entries.map(([, v]) => v);
      await query(
        `UPDATE quotations SET ${setClauses.join(", ")}, updated_at = NOW() WHERE id = $${entries.length + 1}`,
        [...values, realId]
      );
    }

    const refreshed = await recalculateAndPersistQuotation(realId);
    const newHeaderSnapshot = extractFinancialSnapshot(refreshed.header);

    if (fields.order_discount_pct !== undefined && Number(fields.order_discount_pct) !== Number(quote.order_discount_pct || 0)) {
      await writeAuditLog({
        entityType: "quotations",
        entityId: realId,
        action: "ORDER_DISCOUNT_CHANGED",
        before: { order_discount_pct: Number(quote.order_discount_pct || 0), header: oldHeaderSnapshot },
        after: { order_discount_pct: Number(fields.order_discount_pct), header: newHeaderSnapshot },
        performedBy: userId,
        reason: fields.reason || `Order discount changed to ${fields.order_discount_pct}%`,
      });
    }

    if (fields.tax_rate_pct !== undefined && Number(fields.tax_rate_pct) !== Number(quote.tax_rate_pct)) {
      await writeAuditLog({
        entityType: "quotations",
        entityId: realId,
        action: "TAX_CHANGED",
        before: { tax_rate_pct: Number(quote.tax_rate_pct), header: oldHeaderSnapshot },
        after: { tax_rate_pct: Number(fields.tax_rate_pct), header: newHeaderSnapshot },
        performedBy: userId,
        reason: fields.reason || `Tax rate changed to ${fields.tax_rate_pct}%`,
      });
    }

    const fullPayload = await getFullQuotationPayload(realId);
    res.json({ data: fullPayload });
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

    assertQuotationNotConfirmed(currentStatus);

    if (currentStatus !== "DRAFT" && currentStatus !== "NEGOTIATION" && currentStatus !== "REJECTED") {
      throw new UnprocessableEntityError("Only DRAFT, NEGOTIATION, or REJECTED quotations can be submitted for approval");
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
      `SELECT q.id, q.currency_code, q.status, c.tier_id as customer_tier_id
       FROM quotations q
       JOIN customers c ON q.customer_id = c.id
       WHERE ${isNumeric ? "q.id = $1" : "q.public_id::text = $1"}`,
      [id]
    );

    if (quoteResult.rows.length === 0) {
      throw new NotFoundError("Quotation", id);
    }

    const quote = quoteResult.rows[0];
    assertQuotationNotConfirmed(quote.status);
    await handleCommercialMutationOnApproved(quote.id, quote.status, userId, "Line added");

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

    const oldHeaderSnapshot = extractFinancialSnapshot(quote);

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
    const lineId = insertResult.rows[0].id;

    const newLineSnapshot = extractLineSnapshot({
      id: lineId,
      product_id: data.product_id,
      product_sku: product.sku || null,
      product_name: product.name,
      quantity: qty,
      unit_price: unitPrice,
      unit_cost: unitCost,
      applied_discount_pct: discPct,
      discount_amount: discAmt,
      line_subtotal: subtotal,
      line_total: lineTotal,
      line_cost: lineCost,
      line_margin: lineMargin,
    });

    await writeAuditLog({
      entityType: "quotation_lines",
      entityId: lineId,
      action: "LINE_ADDED",
      before: { header: oldHeaderSnapshot, line: null },
      after: { header: oldHeaderSnapshot, line: newLineSnapshot },
      performedBy: userId,
      reason: data.reason || "Line added",
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

    const { quote } = await fetchQuoteContext(id);
    assertQuotationNotConfirmed(quote.status);
    await handleCommercialMutationOnApproved(quote.id, quote.status, userId, "Line updated");

    const oldLineRes = await query(
      `SELECT ql.*, p.sku as product_sku, p.name as product_name
       FROM quotation_lines ql
       JOIN products p ON ql.product_id = p.id
       WHERE ql.id = $1 AND ql.quotation_id = $2`,
      [lineId, quote.id]
    );

    if (oldLineRes.rows.length === 0) {
      throw new NotFoundError("QuotationLine", lineId);
    }

    const oldLine = oldLineRes.rows[0];
    const oldLineSnapshot = extractLineSnapshot(oldLine);
    const oldHeaderSnapshot = extractFinancialSnapshot(quote);

    const entries = Object.entries(fields).filter(([k, v]) => v !== undefined && k !== "reason");
    if (entries.length > 0) {
      const setClauses = entries.map(([k], i) => `${k} = $${i + 1}`);
      const values = entries.map(([, v]) => v);

      await query(
        `UPDATE quotation_lines SET ${setClauses.join(", ")}, updated_at = NOW() WHERE id = $${entries.length + 1}`,
        [...values, lineId]
      );
    }

    const refreshed = await recalculateAndPersistQuotation(quote.id);
    const newHeaderSnapshot = extractFinancialSnapshot(refreshed.header);
    const newLineSnapshot = extractLineSnapshot({ ...oldLine, ...fields });

    let action = "LINE_UPDATED";
    if (fields.quantity !== undefined && Number(fields.quantity) !== Number(oldLine.quantity)) {
      action = "QUANTITY_CHANGED";
    } else if (fields.unit_price !== undefined && Number(fields.unit_price) !== Number(oldLine.unit_price)) {
      action = "PRICE_CHANGED";
    } else if (fields.applied_discount_pct !== undefined && Number(fields.applied_discount_pct) !== Number(oldLine.applied_discount_pct)) {
      action = "LINE_DISCOUNT_CHANGED";
    } else if (fields.product_variant_id !== undefined && Number(fields.product_variant_id) !== Number(oldLine.product_variant_id)) {
      action = "VARIANT_CHANGED";
    }

    await writeAuditLog({
      entityType: "quotation_lines",
      entityId: lineId,
      action,
      before: { header: oldHeaderSnapshot, line: oldLineSnapshot },
      after: { header: newHeaderSnapshot, line: newLineSnapshot },
      performedBy: userId,
      reason: fields.reason || "Line updated",
    });

    if (refreshed.header.status === "PENDING_APPROVAL") {
      await reopenApprovalAfterEdit(quote.id, userId, refreshed);
    }
    const fullPayload = await getFullQuotationPayload(quote.id);
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

    const { quote } = await fetchQuoteContext(id);
    assertQuotationNotConfirmed(quote.status);
    await handleCommercialMutationOnApproved(quote.id, quote.status, userId, "Line deleted");

    const oldLineRes = await query(
      `SELECT ql.*, p.sku as product_sku, p.name as product_name
       FROM quotation_lines ql
       JOIN products p ON ql.product_id = p.id
       WHERE ql.id = $1 AND ql.quotation_id = $2`,
      [lineId, quote.id]
    );

    if (oldLineRes.rows.length === 0) {
      throw new NotFoundError("QuotationLine", lineId);
    }

    const oldLineSnapshot = extractLineSnapshot(oldLineRes.rows[0]);
    const oldHeaderSnapshot = extractFinancialSnapshot(quote);

    await query(`DELETE FROM quotation_lines WHERE id = $1 AND quotation_id = $2`, [lineId, quote.id]);

    const refreshed = await recalculateAndPersistQuotation(quote.id);
    const newHeaderSnapshot = extractFinancialSnapshot(refreshed.header);

    const reason = (req.body && req.body.reason) ? req.body.reason : "Line removed";

    await writeAuditLog({
      entityType: "quotation_lines",
      entityId: lineId,
      action: "LINE_REMOVED",
      before: { header: oldHeaderSnapshot, line: oldLineSnapshot },
      after: { header: newHeaderSnapshot, line: null },
      performedBy: userId,
      reason,
    });

    if (refreshed.header.status === "PENDING_APPROVAL") {
      await reopenApprovalAfterEdit(quote.id, userId, refreshed);
    }
    const fullPayload = await getFullQuotationPayload(quote.id);
    res.json({ data: fullPayload });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/quotations/:id/recalculate
quotationsRouter.post("/:id/recalculate", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { quote } = await fetchQuoteContext(id);
    assertQuotationNotConfirmed(quote.status);
    await recalculateAndPersistQuotation(quote.id);
    const fullPayload = await getFullQuotationPayload(quote.id);
    res.json({ data: fullPayload });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/quotations/:id/withdraw (PENDING_APPROVAL -> DRAFT)
quotationsRouter.post("/:id/withdraw", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.userId;
    const userRole = Number((req as any).user.roleId);

    const { quote } = await fetchQuoteContext(id);
    const quoteId = quote.id;
    const currentStatus = quote.status;

    assertQuotationNotConfirmed(currentStatus);

    if (currentStatus !== "PENDING_APPROVAL") {
      throw new UnprocessableEntityError("Only PENDING_APPROVAL quotations can be withdrawn to DRAFT");
    }

    if (quote.sales_rep_id !== userId && userRole !== ROLES.ADMIN && userRole !== ROLES.SALES_MANAGER) {
      throw new ForbiddenError("You are not authorized to withdraw this quotation approval request");
    }

    // Cancel open approval request if any
    const openApproval = await query(
      `SELECT id FROM approval_requests WHERE quotation_id = $1 AND status = 'PENDING_APPROVAL'`,
      [quoteId]
    );
    for (const reqRow of openApproval.rows) {
      await query(
        `UPDATE approval_requests SET status = 'CANCELLED', decided_by = $2, decided_at = NOW(), notes = $3 WHERE id = $1`,
        [reqRow.id, userId, "Approval withdrawn by user"]
      );
      await writeAuditLog({
        entityType: "approval_requests",
        entityId: reqRow.id,
        action: "CANCELLED",
        before: { status: "PENDING_APPROVAL" },
        after: { status: "CANCELLED" },
        performedBy: userId,
        reason: "Approval withdrawn by user",
      });
    }

    await query(`UPDATE quotations SET status = 'DRAFT', updated_at = NOW() WHERE id = $1`, [quoteId]);

    await writeAuditLog({
      entityType: "quotations",
      entityId: quoteId,
      action: "WITHDRAWN",
      before: { status: "PENDING_APPROVAL" },
      after: { status: "DRAFT" },
      performedBy: userId,
      reason: "Approval request withdrawn to DRAFT",
    });

    const fullPayload = await getFullQuotationPayload(quoteId);
    res.json({ data: fullPayload });
  } catch (err) {
    next(err);
  }
});

const cancelSchema = z.object({
  reason: z.string().optional(),
});

// POST /api/v1/quotations/:id/cancel
quotationsRouter.post("/:id/cancel", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER, ROLES.FINANCE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.userId;
    const { reason } = cancelSchema.parse(req.body ?? {});

    const { quote } = await fetchQuoteContext(id);
    const quoteId = quote.id;
    const currentStatus = quote.status;

    if (currentStatus === "CONFIRMED") {
      throw new ConflictError("Confirmed quotations are locked and cannot be cancelled");
    }

    if (currentStatus === "CANCELLED") {
      throw new UnprocessableEntityError("Quotation is already cancelled");
    }

    // Invalidate open approval requests if any
    const openApproval = await query(
      `SELECT id FROM approval_requests WHERE quotation_id = $1 AND status = 'PENDING_APPROVAL'`,
      [quoteId]
    );
    for (const reqRow of openApproval.rows) {
      await query(
        `UPDATE approval_requests SET status = 'CANCELLED', decided_by = $2, decided_at = NOW(), notes = $3 WHERE id = $1`,
        [reqRow.id, userId, reason || "Quotation cancelled"]
      );
      await writeAuditLog({
        entityType: "approval_requests",
        entityId: reqRow.id,
        action: "CANCELLED",
        before: { status: "PENDING_APPROVAL" },
        after: { status: "CANCELLED" },
        performedBy: userId,
        reason: reason || "Quotation cancelled",
      });
    }

    await query(`UPDATE quotations SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`, [quoteId]);

    await writeAuditLog({
      entityType: "quotations",
      entityId: quoteId,
      action: "CANCELLED",
      before: { status: currentStatus },
      after: { status: "CANCELLED" },
      performedBy: userId,
      reason: reason || "Quotation cancelled by user",
    });

    const fullPayload = await getFullQuotationPayload(quoteId);
    res.json({ data: fullPayload });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/quotations/:id/timeline — unified Decision History timeline endpoint
quotationsRouter.get("/:id/timeline", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER, ROLES.FINANCE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.userId;
    const userRole = Number((req as any).user.roleId);

    const { quote } = await fetchQuoteContext(id);
    const realId = Number(quote.id);

    // RBAC Ownership Check
    if (userRole === ROLES.SALES_REP && quote.sales_rep_id !== userId) {
      const custCheck = await query(`SELECT sales_rep_id FROM customers WHERE id = $1`, [quote.customer_id]);
      if (custCheck.rows.length === 0 || Number(custCheck.rows[0].sales_rep_id) !== userId) {
        throw new ForbiddenError("You do not have permission to view the audit timeline for this quotation");
      }
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));

    // 1. Current Header & Customer Context
    const headerRes = await query(
      `SELECT q.*, c.name as customer_name, c.payment_terms, ct.name as tier_name
       FROM quotations q
       JOIN customers c ON q.customer_id = c.id
       LEFT JOIN customer_tiers ct ON c.tier_id = ct.id
       WHERE q.id = $1`,
      [realId]
    );
    const currentHeader = headerRes.rows[0];

    // Counts
    const approvalCountRes = await query(`SELECT COUNT(*) FROM approval_requests WHERE quotation_id = $1`, [realId]);
    const approvalCyclesCount = parseInt(approvalCountRes.rows[0].count);

    const negCountRes = await query(
      `SELECT COUNT(*) FROM negotiation_requests nr
       JOIN negotiations n ON nr.negotiation_id = n.id
       WHERE n.quotation_id = $1`,
      [realId]
    );
    const negotiationRoundsCount = parseInt(negCountRes.rows[0].count);

    // 2. Historical Original Values (only when reliably available from earliest audit log)
    const creationAuditRes = await query(
      `SELECT * FROM audit_logs
       WHERE entity_type = 'quotations' AND entity_id = $1::text AND action IN ('CREATED', 'QUOTE_CREATED')
       ORDER BY created_at ASC LIMIT 1`,
      [realId]
    );
    let originalMetrics: any = null;
    if (creationAuditRes.rows.length > 0 && creationAuditRes.rows[0].after?.header) {
      const origHeader = creationAuditRes.rows[0].after.header;
      originalMetrics = {
        original_grand_total: Number(origHeader.grand_total || 0),
        original_discount_total: Number(origHeader.discount_total || 0),
        original_margin_pct: Number(origHeader.margin_pct || 0),
        original_risk_level: origHeader.risk_level || "LOW",
      };
    }

    // 3. Derived Decision Signals
    const decisionSignals: Array<{ type: "warning" | "info" | "success"; text: string }> = [];
    if (currentHeader.risk_level === "HIGH") {
      decisionSignals.push({ type: "warning", text: "High Discount Risk" });
    }
    if (Number(currentHeader.total_overage) > 0) {
      const overageVal = parseFloat(Number(currentHeader.total_overage).toFixed(2));
      decisionSignals.push({ type: "warning", text: `Overage of ${overageVal}% over allowed tier discount` });
    }
    if (currentHeader.status === "PENDING_APPROVAL" || currentHeader.status === "PENDING_REAPPROVAL") {
      decisionSignals.push({ type: "warning", text: "Approval Required" });
    }
    if (approvalCyclesCount > 1) {
      decisionSignals.push({ type: "info", text: `${approvalCyclesCount} Approval Cycles` });
    }
    if (negotiationRoundsCount > 0) {
      decisionSignals.push({ type: "info", text: `${negotiationRoundsCount} Customer Negotiation Request(s)` });
    }
    if (originalMetrics && Number(currentHeader.margin_pct) < originalMetrics.original_margin_pct) {
      const drop = (originalMetrics.original_margin_pct - Number(currentHeader.margin_pct)).toFixed(1);
      decisionSignals.push({ type: "warning", text: `Margin decreased by ${drop}%` });
    }
    if (currentHeader.status === "CONFIRMED") {
      decisionSignals.push({ type: "success", text: "Quotation Confirmed" });
    } else if (currentHeader.status === "APPROVED") {
      decisionSignals.push({ type: "success", text: "Quotation Approved" });
    }

    // 4. Raw Audit Logs for Quotation and Linked Entities
    const rawLogsRes = await query(
      `SELECT a.*, (u.first_name || ' ' || u.last_name) as actor_name, r.name as actor_role
       FROM audit_logs a
       LEFT JOIN users u ON a.performed_by = u.id
       LEFT JOIN roles r ON u.role_id = r.id
       WHERE (a.entity_type = 'quotations' AND a.entity_id = $1::text)
          OR (a.entity_type = 'quotation_lines' AND a.entity_id IN (SELECT id::text FROM quotation_lines WHERE quotation_id = $1::bigint))
          OR (a.entity_type = 'approval_requests' AND a.entity_id IN (SELECT id::text FROM approval_requests WHERE quotation_id = $1::bigint))
          OR (a.entity_type = 'fulfillment_orders' AND a.entity_id IN (SELECT id::text FROM fulfillment_orders WHERE quotation_id = $1::bigint))
          OR (a.entity_type = 'subscriptions' AND a.entity_id IN (SELECT id::text FROM subscriptions WHERE quotation_id = $1::bigint))
          OR (a.entity_type = 'invoices' AND a.entity_id IN (SELECT id::text FROM invoices WHERE quotation_id = $1::bigint))
       ORDER BY a.created_at DESC`,
      [realId]
    );

    // 5. Decided Approval Steps (for step notes & approver roles)
    const approvalStepsRes = await query(
      `SELECT s.*, r.name as role_name, (u.first_name || ' ' || u.last_name) as decider_name, req.quotation_id
       FROM approval_steps s
       JOIN approval_requests req ON s.approval_request_id = req.id
       LEFT JOIN roles r ON s.role_id = r.id
       LEFT JOIN users u ON s.decided_by = u.id
       WHERE req.quotation_id = $1 AND s.status != 'PENDING'
       ORDER BY s.decided_at DESC`,
      [realId]
    );

    // 6. Build & Deduplicate Timeline Stream
    const timelineItems: Array<{
      id: string;
      timestamp: string;
      action: string;
      category: "Pricing" | "Line Items" | "Approvals" | "Negotiations" | "Fulfillment" | "Billing" | "Status";
      title: string;
      description: string;
      reason: string | null;
      actor: { name: string; role: string } | null;
      before: any;
      after: any;
      financial_impact: { before: any; after: any } | null;
    }> = [];

    const rawLogs = rawLogsRes.rows;
    let currentSessionLogs: any[] = [];

    function flushSession() {
      if (currentSessionLogs.length === 0) return;
      const first = currentSessionLogs[0];
      const last = currentSessionLogs[currentSessionLogs.length - 1];
      const count = currentSessionLogs.length;

      let finBefore = first.before?.header || first.before?.line || null;
      let finAfter = last.after?.header || last.after?.line || null;

      const hasReopen = currentSessionLogs.some(l => l.action === "REOPENED");
      const hasLineEdit = currentSessionLogs.some(l => [
        "LINE_ADDED", "LINE_UPDATED", "LINE_REMOVED", "QUANTITY_CHANGED",
        "PRICE_CHANGED", "LINE_DISCOUNT_CHANGED", "VARIANT_CHANGED", "LINE_UPDATED_BY_NEGOTIATION"
      ].includes(l.action));

      let category: "Pricing" | "Line Items" | "Approvals" | "Negotiations" | "Fulfillment" | "Billing" | "Status" = hasLineEdit ? "Line Items" : "Approvals";
      let title = "Quotation Revised";

      if (hasReopen && hasLineEdit) {
        title = count > 1 ? `Quotation Revised & Re-opened (${count} updates)` : "Quotation Revised & Re-opened";
        category = "Approvals";
      } else if (hasLineEdit) {
        title = count > 1 ? `Quotation Items & Pricing Revised (${count} updates)` : "Quotation Line Item Updated";
        category = "Line Items";
      } else if (hasReopen) {
        title = "Quotation Re-opened for Approval";
        category = "Approvals";
      }

      const reasons = currentSessionLogs
        .map(l => l.reason)
        .filter((v, i, self) => v && self.indexOf(v) === i);

      timelineItems.push({
        id: `session_${first.id}_${last.id}`,
        timestamp: last.created_at,
        action: hasReopen ? "REOPENED" : "LINE_ITEMS_REVISED",
        category,
        title,
        description: reasons.length > 0 ? reasons.join("; ") : `${title} by ${first.actor_name || "User"}`,
        reason: last.reason || null,
        actor: first.performed_by ? { name: first.actor_name || "User", role: first.actor_role || "Staff" } : null,
        before: first.before || null,
        after: last.after || null,
        financial_impact: (finBefore || finAfter) ? { before: finBefore, after: finAfter } : null,
      });

      currentSessionLogs = [];
    }

    for (const log of rawLogs) {
      // Filter internal background engine logs
      if (log.entity_type === "approval_requests" && ["CREATED", "CANCELLED"].includes(log.action)) {
        continue;
      }
      if (log.action.startsWith("DECISION_")) continue;

      const isSessionable = [
        "LINE_ADDED", "LINE_UPDATED", "LINE_REMOVED", "QUANTITY_CHANGED",
        "PRICE_CHANGED", "LINE_DISCOUNT_CHANGED", "VARIANT_CHANGED",
        "LINE_UPDATED_BY_NEGOTIATION", "REOPENED"
      ].includes(log.action);

      if (isSessionable) {
        if (currentSessionLogs.length > 0) {
          const prev = currentSessionLogs[currentSessionLogs.length - 1];
          const timeDiffMs = new Date(log.created_at).getTime() - new Date(prev.created_at).getTime();
          if (prev.performed_by === log.performed_by && timeDiffMs < 10 * 60 * 1000) {
            currentSessionLogs.push(log);
            continue;
          } else {
            flushSession();
          }
        }
        currentSessionLogs.push(log);
      } else {
        flushSession();

        let category: "Pricing" | "Line Items" | "Approvals" | "Negotiations" | "Fulfillment" | "Billing" | "Status" = "Status";
        let title = log.action.replace(/_/g, " ");

        if (log.action === "CREATED" || log.action === "QUOTE_CREATED") {
          title = "Quotation Created";
          category = "Status";
        } else if (log.action === "SUBMITTED") {
          title = "Submitted for Manager Approval";
          category = "Approvals";
        } else if (log.action === "APPROVED") {
          title = "Quotation Approved";
          category = "Approvals";
        } else if (log.action.includes("NEGOTIATION")) {
          title = log.action === "NEGOTIATION" ? "Customer Requested Negotiation" : "Negotiation Resolved";
          category = "Negotiations";
        } else if (log.action === "CONFIRMED") {
          title = "Quotation Confirmed & Accepted by Customer";
          category = "Status";
        } else if (log.action.includes("SUBSCRIPTION")) {
          title = "Subscription Created";
          category = "Billing";
        } else if (log.action.includes("INVOICE")) {
          title = "Invoice Issued";
          category = "Billing";
        }

        let finBefore = log.before?.header || null;
        let finAfter = log.after?.header || null;

        timelineItems.push({
          id: `audit_${log.id}`,
          timestamp: log.created_at,
          action: log.action,
          category,
          title,
          description: log.reason || `${title} completed`,
          reason: log.reason || null,
          actor: log.performed_by ? { name: log.actor_name || "User", role: log.actor_role || "Staff" } : null,
          before: log.before || null,
          after: log.after || null,
          financial_impact: (finBefore || finAfter) ? { before: finBefore, after: finAfter } : null,
        });
      }
    }

    flushSession();

    for (const step of approvalStepsRes.rows) {
      timelineItems.push({
        id: `step_${step.id}`,
        timestamp: step.decided_at,
        action: step.status,
        category: "Approvals",
        title: `Approval Step ${step.sequence}: ${step.status}`,
        description: step.notes ? `Reason: "${step.notes}"` : `Decided by ${step.decider_name || "Approver"} (${step.role_name || "Approver"})`,
        reason: step.notes || null,
        actor: { name: step.decider_name || "Approver", role: step.role_name || "Approver" },
        before: null,
        after: { status: step.status },
        financial_impact: null,
      });
    }

    timelineItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const total = timelineItems.length;
    const offset = (page - 1) * limit;
    const pagedItems = timelineItems.slice(offset, offset + limit);

    res.json({
      data: {
        decision_context: {
          current: {
            grand_total: Number(currentHeader.grand_total),
            discount_total: Number(currentHeader.discount_total),
            order_discount_pct: Number(currentHeader.order_discount_pct || 0),
            margin_pct: Number(currentHeader.margin_pct),
            risk_level: currentHeader.risk_level,
            total_overage: Number(currentHeader.total_overage),
            currency_code: currentHeader.currency_code,
            status: currentHeader.status,
            customer_name: currentHeader.customer_name,
            tier_name: currentHeader.tier_name,
            payment_terms: currentHeader.payment_terms,
            approval_cycles_count: approvalCyclesCount,
            negotiation_rounds_count: negotiationRoundsCount,
          },
          historical: originalMetrics,
        },
        decision_signals: decisionSignals,
        timeline: pagedItems,
      },
      meta: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});