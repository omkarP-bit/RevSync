import { Router, Request, Response, NextFunction } from "express";
import { query } from "../../database/pool.js";
import { authenticate, requireRole, ROLES } from "../../middleware/auth.js";
import { authenticateCustomer } from "../../middleware/customerAuth.js";
import { NotFoundError, ValidationError, UnprocessableEntityError, ForbiddenError, ConflictError } from "../../shared/errors.js";
import { writeAuditLog } from "../../shared/audit.js";
import {
  recalculateAndPersistQuotation,
  createApprovalRequest,
  fetchApprovalRules,
} from "../../shared/quote-workflow.js";
import { selectRiskRule, RiskLevel } from "../../engines/approval-engine.js";
import { z } from "zod";

export const negotiationsRouter = Router();
negotiationsRouter.use(authenticate);

export const negotiationsPortalRouter = Router();
negotiationsPortalRouter.use(authenticateCustomer);

const createRequestSchema = z.object({
  request_type: z.enum(["DISCOUNT", "DELIVERY_DATE", "TERMS"]),
  quotation_line_id: z.coerce.number().int().positive().nullable().optional(),
  requested_value: z.string().min(1).max(50),
  message: z.string().max(1000).optional(),
});

const messageSchema = z.object({
  body: z.string().min(1).max(2000),
});

const decisionSchema = z.object({
  notes: z.string().max(1000).optional(),
});

const openNegotiationSchema = z.object({
  quotation_id: z.coerce.number().int().positive(),
});

interface NegotiationRow {
  id: number;
  quotation_id: number;
  status: string;
  public_id: string;
  quotation_number: string;
  customer_id: number;
  customer_name: string;
  currency_code: string;
  grand_total: number;
  quotation_status: string;
}

async function fetchNegotiation(negotiationId: number | string, openOnly = false): Promise<NegotiationRow> {
  const result = await query(
    `SELECT n.id, n.quotation_id, n.status, q.public_id, q.quotation_number,
            q.customer_id, c.name as customer_name, q.currency_code, q.grand_total,
            q.status as quotation_status
     FROM negotiations n
     JOIN quotations q ON n.quotation_id = q.id
     JOIN customers c ON q.customer_id = c.id
     WHERE n.id = $1`,
    [negotiationId]
  );
  if (result.rows.length === 0) {
    throw new NotFoundError("Negotiation", negotiationId);
  }
  const row = result.rows[0];
  if (openOnly && row.status !== "OPEN") {
    throw new UnprocessableEntityError("This negotiation is closed");
  }
  return {
    ...row,
    id: Number(row.id),
    quotation_id: Number(row.quotation_id),
    customer_id: Number(row.customer_id),
    grand_total: Number(row.grand_total),
  };
}

async function fetchRequests(negotiationId: number): Promise<any[]> {
  const result = await query(
    `SELECT nr.id, nr.quotation_line_id, p.name as product_name, nr.request_type, nr.status,
            nr.original_value, nr.requested_value, nr.message, nr.requested_by_customer,
            nr.requested_by, nr.resolved_by, nr.resolved_at, nr.created_at
     FROM negotiation_requests nr
     LEFT JOIN quotation_lines ql ON nr.quotation_line_id = ql.id
     LEFT JOIN products p ON ql.product_id = p.id
     WHERE nr.negotiation_id = $1
     ORDER BY nr.created_at ASC, nr.id ASC`,
    [negotiationId]
  );
  return result.rows;
}

async function fetchMessages(negotiationId: number): Promise<any[]> {
  const result = await query(
    `SELECT m.id, m.sender_type, m.sender_user_id, m.body, m.created_at
     FROM negotiation_messages m
     WHERE m.negotiation_id = $1
     ORDER BY m.created_at ASC, m.id ASC`,
    [negotiationId]
  );
  return result.rows;
}

async function negotiationPayload(negotiationId: number): Promise<any> {
  const negotiation = await fetchNegotiation(negotiationId);
  const requests = await fetchRequests(negotiation.id);
  const messages = await fetchMessages(negotiation.id);
  return {
    ...negotiation,
    status: negotiation.status,
    requests: requests.map((r) => ({
      ...r,
      id: Number(r.id),
      quotation_line_id: r.quotation_line_id ? Number(r.quotation_line_id) : null,
      requested_by: r.requested_by ? Number(r.requested_by) : null,
      resolved_by: r.resolved_by ? Number(r.resolved_by) : null,
    })),
    messages: messages.map((m) => ({
      ...m,
      id: Number(m.id),
      sender_user_id: m.sender_user_id ? Number(m.sender_user_id) : null,
    })),
  };
}

// Supersede any open approval request on a quotation and issue a fresh one
// from the current (post-discount) risk level, reusing the Phase 4 engine.
async function reapproveQuotation(quotationId: number, refreshed: { risk_level: RiskLevel; total_overage: number }, actorId: number): Promise<void> {
  const openResult = await query(
    `SELECT id FROM approval_requests
     WHERE quotation_id = $1 AND status = 'PENDING_APPROVAL'`,
    [quotationId]
  );

  for (const req of openResult.rows) {
    await query(
      `UPDATE approval_requests SET
         status = 'CANCELLED', decided_by = $2, decided_at = NOW(),
         notes = 'Negotiation-accepted discount superseded this approval'
       WHERE id = $1`,
      [req.id, actorId]
    );
    await writeAuditLog({
      entityType: "approval_requests",
      entityId: req.id,
      action: "CANCELLED",
      before: { status: "PENDING_APPROVAL" },
      after: { status: "CANCELLED" },
      performedBy: actorId,
      reason: "Negotiation-accepted discount superseded this approval",
    });
  }

  if (refreshed.risk_level === "LOW") {
    await query(`UPDATE quotations SET status = 'APPROVED', updated_at = NOW() WHERE id = $1`, [quotationId]);
    await writeAuditLog({
      entityType: "quotations",
      entityId: quotationId,
      action: "APPROVED",
      before: { status: "NEGOTIATION" },
      after: { status: "APPROVED" },
      performedBy: actorId,
      reason: "Overage within limits after negotiation-accepted discount",
    });
    return;
  }

  const approvalRules = (await fetchApprovalRules()).map((r) => ({
    id: Number(r.id),
    risk_level: r.risk_level as RiskLevel,
    min_total_overage: Number(r.min_total_overage),
    role_sequence: r.role_sequence.map(Number),
    is_active: Boolean(r.is_active),
  }));
  const riskRule = selectRiskRule(refreshed.total_overage, approvalRules);

  await createApprovalRequest({
    quotationId,
    risk_level: refreshed.risk_level,
    total_overage: refreshed.total_overage,
    submittedBy: actorId,
    notes: "Auto re-approved after negotiation-accepted discount",
    rule: riskRule,
  });
  await query(`UPDATE quotations SET status = 'PENDING_APPROVAL', updated_at = NOW() WHERE id = $1`, [quotationId]);
}

// Accept a PENDING request. DISCOUNT acceptance applies the value and runs the
// full Phase 4 recalc; risk above threshold triggers an automatic re-approval.
async function resolveAndApply(negotiationIdParam: string, req: Request, res: Response, next: NextFunction, approve: boolean): Promise<void> {
  try {
    const { requestId } = req.params;
    const userId = (req as any).user.userId;
    const { notes } = decisionSchema.parse(req.body ?? {});

    const negotiation = await fetchNegotiation(negotiationIdParam);

    const scoped = await query(
      `SELECT id, negotiation_id, quotation_line_id, request_type, status, requested_value
       FROM negotiation_requests
       WHERE id = $1 AND negotiation_id = $2`,
      [requestId, negotiation.id]
    );
    if (scoped.rows.length === 0) {
      throw new NotFoundError("Negotiation request", requestId);
    }
    const request = scoped.rows[0];
    if (request.status !== "PENDING") {
      throw new UnprocessableEntityError("This request has already been decided");
    }

    let quotationStatus: string | null = null;
    let refreshed: { risk_level: RiskLevel; total_overage: number } | null = null;

    if (approve) {
      if (request.request_type === "DISCOUNT") {
        const pct = parseFloat(request.requested_value);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
          throw new ValidationError("Invalid requested discount value");
        }
        const updateResult = await query(
          `UPDATE quotation_lines SET applied_discount_pct = $1, updated_at = NOW()
           WHERE id = $2 AND quotation_id = $3 RETURNING id`,
          [pct, request.quotation_line_id, negotiation.quotation_id]
        );
        if (updateResult.rows.length === 0) {
          throw new NotFoundError("Quotation line", request.quotation_line_id);
        }
        await writeAuditLog({
          entityType: "quotation_lines",
          entityId: request.quotation_line_id,
          action: "LINE_UPDATED_BY_NEGOTIATION",
          before: null,
          after: { applied_discount_pct: pct },
          performedBy: userId,
          reason: notes || "Discount accepted from negotiation request",
        });
        refreshed = await recalculateAndPersistQuotation(negotiation.quotation_id);
        quotationStatus = refreshed.risk_level === "LOW" ? "APPROVED" : "PENDING_REAPPROVAL";
        await query(`UPDATE quotations SET status = $1, updated_at = NOW() WHERE id = $2`, [quotationStatus, negotiation.quotation_id]);
        await reapproveQuotation(negotiation.quotation_id, refreshed, userId);
      }
      await query(
        `UPDATE negotiation_requests SET
           status = 'ACCEPTED', resolved_by = $1, resolved_at = NOW(), message = COALESCE($2, message)
         WHERE id = $3`,
        [userId, notes ?? null, request.id]
      );
      await writeAuditLog({
        entityType: "negotiation_requests",
        entityId: request.id,
        action: "ACCEPTED",
        before: { status: "PENDING" },
        after: { status: "ACCEPTED", quotation_status: quotationStatus },
        performedBy: userId,
        reason: notes || "Negotiation request accepted",
      });
    } else {
      await query(
        `UPDATE negotiation_requests SET
           status = 'REJECTED', resolved_by = $1, resolved_at = NOW(), message = COALESCE($2, message)
         WHERE id = $3`,
        [userId, notes ?? null, request.id]
      );
      await writeAuditLog({
        entityType: "negotiation_requests",
        entityId: request.id,
        action: "REJECTED",
        before: { status: "PENDING" },
        after: { status: "REJECTED" },
        performedBy: userId,
        reason: notes || "Negotiation request rejected",
      });
    }

    res.json({ data: await negotiationPayload(negotiation.id) });
  } catch (err) {
    next(err);
  }
}

// Capture the current applied discount as the request's original_value.
async function originalValueFor(quotationId: number, requestType: string, lineId: number | null): Promise<string | null> {
  if (requestType === "DISCOUNT" && lineId != null) {
    const result = await query(
      `SELECT applied_discount_pct FROM quotation_lines WHERE id = $1 AND quotation_id = $2`,
      [lineId, quotationId]
    );
    if (result.rows.length > 0) return String(result.rows[0].applied_discount_pct);
  }
  return null;
}

// ---- Internal endpoints (Sales) ----

// POST /api/v1/negotiations
negotiationsRouter.post("/", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const { quotation_id } = openNegotiationSchema.parse(req.body);

    const quoteResult = await query(
      `SELECT q.id, q.public_id, q.quotation_number, q.status, q.customer_id, c.name as customer_name
       FROM quotations q JOIN customers c ON q.customer_id = c.id
       WHERE q.id = $1`,
      [quotation_id]
    );
    if (quoteResult.rows.length === 0) {
      throw new NotFoundError("Quotation", quotation_id);
    }
    const quote = quoteResult.rows[0];

    if (quote.status !== "APPROVED" && quote.status !== "NEGOTIATION") {
      throw new UnprocessableEntityError("Only APPROVED or NEGOTIATION quotations can be opened for negotiation");
    }

    const existing = await query(
      `SELECT id FROM negotiations WHERE quotation_id = $1 AND status = 'OPEN'`,
      [quote.id]
    );
    if (existing.rows.length > 0) {
      throw new ConflictError("A negotiation is already open for this quotation");
    }

    const insertResult = await query(
      `INSERT INTO negotiations (quotation_id) VALUES ($1) RETURNING id`,
      [quote.id]
    );

    await query(`UPDATE quotations SET status = 'NEGOTIATION', updated_at = NOW() WHERE id = $1`, [quote.id]);
    await writeAuditLog({
      entityType: "negotiations",
      entityId: insertResult.rows[0].id,
      action: "OPENED",
      before: null,
      after: { quotation_id: quote.id, quotation_number: quote.quotation_number },
      performedBy: userId,
      reason: "Negotiation opened for quotation",
    });

    res.status(201).json({ data: await negotiationPayload(insertResult.rows[0].id) });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/negotiations
negotiationsRouter.get("/", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (req.query.status) {
      where.push(`n.status = $${paramIdx++}`);
      params.push(req.query.status);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const countResult = await query(`SELECT COUNT(*) FROM negotiations n ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT n.id, n.quotation_id, q.public_id, q.quotation_number, c.name as customer_name,
              n.status as negotiation_status, q.status as quotation_status, q.currency_code,
              q.grand_total, n.created_at, n.updated_at
       FROM negotiations n
       JOIN quotations q ON n.quotation_id = q.id
       JOIN customers c ON q.customer_id = c.id
       ${whereClause}
       ORDER BY n.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    res.json({
      data: result.rows.map((r) => ({
        id: Number(r.id),
        quotation_id: Number(r.quotation_id),
        public_id: r.public_id,
        quotation_number: r.quotation_number,
        customer_name: r.customer_name,
        negotiation_status: r.negotiation_status,
        quotation_status: r.quotation_status,
        currency_code: r.currency_code,
        grand_total: Number(r.grand_total),
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/negotiations/:id
negotiationsRouter.get("/:id", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ data: await negotiationPayload(parseInt(req.params.id)) });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/negotiations/:id/requests
negotiationsRouter.post("/:id/requests", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const negotiation = await fetchNegotiation(parseInt(req.params.id), true);
    const body = createRequestSchema.parse(req.body);

    if (body.request_type === "DISCOUNT" && body.quotation_line_id == null) {
      throw new ValidationError("Discount requests require a quotation_line_id");
    }
    const original_value = await originalValueFor(negotiation.quotation_id, body.request_type, body.quotation_line_id ?? null);

    const result = await query(
      `INSERT INTO negotiation_requests
         (negotiation_id, quotation_line_id, request_type, original_value, requested_value, requested_by_customer, requested_by, message)
       VALUES ($1, $2, $3, $4, $5, false, $6, $7)
       RETURNING id`,
      [negotiation.id, body.quotation_line_id ?? null, body.request_type, original_value, body.requested_value, userId, body.message ?? null]
    );

    await writeAuditLog({
      entityType: "negotiation_requests",
      entityId: result.rows[0].id,
      action: "CREATED_BY_SALES",
      before: null,
      after: { request_type: body.request_type, requested_value: body.requested_value },
      performedBy: userId,
      reason: body.message || "Sales raised a negotiation request",
    });

    res.status(201).json({ data: await negotiationPayload(negotiation.id) });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/negotiations/:id/requests/:requestId/accept
negotiationsRouter.post(
  "/:id/requests/:requestId/accept",
  requireRole(ROLES.ADMIN, ROLES.SALES_MANAGER),
  async (req, res, next) => resolveAndApply(req.params.id, req, res, next, true)
);

// POST /api/v1/negotiations/:id/requests/:requestId/reject
negotiationsRouter.post(
  "/:id/requests/:requestId/reject",
  requireRole(ROLES.ADMIN, ROLES.SALES_MANAGER),
  async (req, res, next) => resolveAndApply(req.params.id, req, res, next, false)
);

// POST /api/v1/negotiations/:id/messages (sales side)
negotiationsRouter.post("/:id/messages", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const negotiation = await fetchNegotiation(parseInt(req.params.id), true);
    const { body } = messageSchema.parse(req.body);

    const result = await query(
      `INSERT INTO negotiation_messages (negotiation_id, sender_type, sender_user_id, body)
       VALUES ($1, 'SALES', $2, $3)
       RETURNING id`,
      [negotiation.id, userId, body]
    );

    await writeAuditLog({
      entityType: "negotiation_messages",
      entityId: result.rows[0].id,
      action: "CREATED_BY_SALES",
      before: null,
      after: { sender_type: "SALES" },
      performedBy: userId,
      reason: "Sales message in negotiation thread",
    });

    res.status(201).json({ data: await negotiationPayload(negotiation.id) });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/negotiations/:id/close
negotiationsRouter.post("/:id/close", requireRole(ROLES.ADMIN, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const negotiation = await fetchNegotiation(parseInt(req.params.id), true);
    await query(`UPDATE negotiations SET status = 'CLOSED', updated_at = NOW() WHERE id = $1`, [negotiation.id]);
    await writeAuditLog({
      entityType: "negotiations",
      entityId: negotiation.id,
      action: "CLOSED",
      before: { status: "OPEN" },
      after: { status: "CLOSED" },
      performedBy: userId,
      reason: "Negotiation closed",
    });
    res.json({ data: await negotiationPayload(negotiation.id) });
  } catch (err) {
    next(err);
  }
});

// ---- Portal endpoints (Customer) ----

const PORTAL_REQUEST_FIELDS = `
      nr.id, nr.quotation_line_id, p.name as product_name, nr.request_type, nr.status,
      nr.original_value, nr.requested_value, nr.message, nr.requested_by_customer,
      nr.resolved_at, nr.created_at`;

// GET /api/v1/portal/negotiations
negotiationsPortalRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customerId = (req as any).customer.customerId;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const countResult = await query(
      `SELECT COUNT(*) FROM negotiations n JOIN quotations q ON n.quotation_id = q.id
       WHERE q.customer_id = $1`,
      [customerId]
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT n.id, q.public_id, q.quotation_number, q.currency_code, q.grand_total,
              q.status as quotation_status, n.status as negotiation_status, n.updated_at
       FROM negotiations n JOIN quotations q ON n.quotation_id = q.id
       WHERE q.customer_id = $1
       ORDER BY n.created_at DESC
       LIMIT $2 OFFSET $3`,
      [customerId, limit, offset]
    );

    res.json({
      data: result.rows.map((r) => ({
        id: Number(r.id),
        public_id: r.public_id,
        quotation_number: r.quotation_number,
        currency_code: r.currency_code,
        grand_total: Number(r.grand_total),
        quotation_status: r.quotation_status,
        negotiation_status: r.negotiation_status,
        updated_at: r.updated_at,
      })),
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

async function getOrCreatePortalNegotiation(quotationPublicId: string, customerId: number) {
  const result = await query(
    `SELECT q.id as quotation_id, q.public_id, q.quotation_number, q.customer_id,
            q.currency_code, q.grand_total, q.status as quotation_status,
            n.id as negotiation_id, n.status as negotiation_status
     FROM quotations q
     LEFT JOIN negotiations n ON n.quotation_id = q.id
     WHERE q.public_id::text = $1`,
    [quotationPublicId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError("Negotiation", quotationPublicId);
  }

  const row = result.rows[0];

  if (Number(row.customer_id) !== Number(customerId)) {
    throw new ForbiddenError("This quotation does not belong to your account");
  }

  let negotiationId: number;
  let negotiationStatus: string;
  let quotationStatus: string = row.quotation_status || "NEGOTIATION";

  const existingId = row.negotiation_id ?? row.id;
  if (existingId) {
    negotiationId = Number(existingId);
    negotiationStatus = row.negotiation_status ?? row.status ?? "OPEN";
  } else {
    const insertResult = await query(
      `INSERT INTO negotiations (quotation_id, status) VALUES ($1, 'OPEN') RETURNING id, status`,
      [row.quotation_id || row.id]
    );
    negotiationId = Number(insertResult.rows[0].id);
    negotiationStatus = insertResult.rows[0].status;

    if (["APPROVED", "SENT", "DRAFT"].includes(quotationStatus)) {
      await query(`UPDATE quotations SET status = 'NEGOTIATION', updated_at = NOW() WHERE id = $1`, [row.quotation_id || row.id]);
      quotationStatus = "NEGOTIATION";
    }

    await writeAuditLog({
      entityType: "negotiations",
      entityId: negotiationId,
      action: "OPENED_BY_CUSTOMER",
      before: null,
      after: { status: "OPEN", quotation_id: row.quotation_id || row.id },
      performedBy: undefined,
      reason: "Customer opened negotiation channel from Customer Portal",
    });
  }

  return {
    id: negotiationId,
    quotation_id: Number(row.quotation_id || row.id),
    public_id: row.public_id,
    quotation_number: row.quotation_number,
    quotation_status: quotationStatus,
    negotiation_status: negotiationStatus,
    currency_code: row.currency_code,
    grand_total: Number(row.grand_total),
  };
}

// GET /api/v1/portal/negotiations/:quotationPublicId
negotiationsPortalRouter.get("/:quotationPublicId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customerId = (req as any).customer.customerId;
    const negotiation = await getOrCreatePortalNegotiation(req.params.quotationPublicId, customerId);

    const requestsResult = await query(
      `SELECT ${PORTAL_REQUEST_FIELDS}
       FROM negotiation_requests nr
       LEFT JOIN quotation_lines ql ON nr.quotation_line_id = ql.id
       LEFT JOIN products p ON ql.product_id = p.id
       WHERE nr.negotiation_id = $1
       ORDER BY nr.created_at ASC, nr.id ASC`,
      [negotiation.id]
    );

    const messagesResult = await query(
      `SELECT m.id, m.sender_type, m.body, m.created_at
       FROM negotiation_messages m
       WHERE m.negotiation_id = $1
       ORDER BY m.created_at ASC, m.id ASC`,
      [negotiation.id]
    );

    const linesResult = await query(
      `SELECT ql.id, ql.product_id, p.name as product_name, ql.description, ql.quantity,
              ql.unit_price, ql.applied_discount_pct, ql.line_total
       FROM quotation_lines ql
       JOIN products p ON ql.product_id = p.id
       WHERE ql.quotation_id = $1
       ORDER BY ql.id ASC`,
      [negotiation.quotation_id]
    );

    res.json({
      data: {
        id: Number(negotiation.id),
        public_id: negotiation.public_id,
        quotation_number: negotiation.quotation_number,
        quotation_status: negotiation.quotation_status,
        negotiation_status: negotiation.negotiation_status,
        currency_code: negotiation.currency_code,
        current_total: Number(negotiation.grand_total),
        requests: requestsResult.rows.map((r) => ({
          ...r,
          id: Number(r.id),
          quotation_line_id: r.quotation_line_id ? Number(r.quotation_line_id) : null,
        })),
        messages: messagesResult.rows.map((m) => ({ ...m, id: Number(m.id) })),
        lines: linesResult.rows.map((l) => ({
          ...l,
          id: Number(l.id),
          product_id: Number(l.product_id),
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price),
          applied_discount_pct: Number(l.applied_discount_pct),
          line_total: Number(l.line_total),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/portal/negotiations/:quotationPublicId/requests
negotiationsPortalRouter.post("/:quotationPublicId/requests", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customerId = (req as any).customer.customerId;
    const body = createRequestSchema.parse(req.body);

    const negotiation = await getOrCreatePortalNegotiation(req.params.quotationPublicId, customerId);
    if (negotiation.quotation_status === "CONFIRMED") throw new ConflictError("Confirmed quotations are locked against further negotiation modifications");
    if (negotiation.negotiation_status !== "OPEN") throw new UnprocessableEntityError("This negotiation is closed");
    if (body.request_type === "DISCOUNT" && body.quotation_line_id == null) {
      throw new ValidationError("Discount requests require a quotation_line_id");
    }

    const original_value = await originalValueFor(negotiation.quotation_id, body.request_type, body.quotation_line_id ?? null);

    const insertResult = await query(
      `INSERT INTO negotiation_requests
         (negotiation_id, quotation_line_id, request_type, original_value, requested_value, requested_by_customer, message)
       VALUES ($1, $2, $3, $4, $5, true, $6)
       RETURNING id`,
      [negotiation.id, body.quotation_line_id ?? null, body.request_type, original_value, body.requested_value, body.message ?? null]
    );

    await writeAuditLog({
      entityType: "negotiation_requests",
      entityId: insertResult.rows[0].id,
      action: "CREATED_BY_CUSTOMER",
      before: null,
      after: { request_type: body.request_type, requested_value: body.requested_value },
      performedBy: undefined,
      reason: body.message || "Customer submitted a negotiation request",
    });

    res.status(201).json({ data: { id: Number(insertResult.rows[0].id), status: "PENDING" } });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/portal/negotiations/:quotationPublicId/messages
negotiationsPortalRouter.post("/:quotationPublicId/messages", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customerId = (req as any).customer.customerId;
    const { body } = messageSchema.parse(req.body);

    const negotiation = await getOrCreatePortalNegotiation(req.params.quotationPublicId, customerId);
    if (negotiation.negotiation_status !== "OPEN") throw new UnprocessableEntityError("This negotiation is closed");

    await query(
      `INSERT INTO negotiation_messages (negotiation_id, sender_type, body)
       VALUES ($1, 'CUSTOMER', $2)`,
      [negotiation.id, body]
    );

    res.status(201).json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
});