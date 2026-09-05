import { Router, Request, Response, NextFunction } from "express";
import { query } from "../../database/pool.js";
import { authenticateCustomer } from "../../middleware/customerAuth.js";
import { NotFoundError, ForbiddenError, UnprocessableEntityError } from "../../shared/errors.js";
import { executeQuotationConfirmation } from "../../shared/quote-workflow.js";
import { getOrCreateWallet } from "../../engines/wallet-engine.js";

export const quotationsPortalRouter = Router();
quotationsPortalRouter.use(authenticateCustomer);

// GET /api/v1/portal/quotations — all customer-visible quotations for authenticated customer
quotationsPortalRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customerId = (req as any).customer.customerId;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const where: string[] = ["q.customer_id = $1"];
    const params: unknown[] = [customerId];
    let paramIdx = 2;

    if (req.query.status) {
      where.push(`q.status = $${paramIdx++}`);
      params.push(req.query.status);
    }

    const whereClause = `WHERE ${where.join(" AND ")}`;

    const countResult = await query(
      `SELECT COUNT(*) FROM quotations q ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT q.id, q.public_id, q.quotation_number, q.currency_code, q.status,
              q.subtotal, q.discount_total, q.order_discount_pct, q.order_discount_amount,
              q.tax_rate_pct, q.tax_total, q.grand_total, q.created_at, q.updated_at,
              n.status as negotiation_status, q.public_id as negotiation_public_id
       FROM quotations q
       LEFT JOIN negotiations n ON n.quotation_id = q.id
       ${whereClause}
       ORDER BY q.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    res.json({
      data: result.rows.map((row: any) => ({
        id: Number(row.id),
        public_id: row.public_id,
        quotation_number: row.quotation_number,
        currency_code: row.currency_code,
        status: row.status,
        subtotal: Number(row.subtotal),
        discount_total: Number(row.discount_total),
        order_discount_pct: Number(row.order_discount_pct || 0),
        tax_rate_pct: Number(row.tax_rate_pct),
        tax_total: Number(row.tax_total),
        grand_total: Number(row.grand_total),
        negotiation_status: row.negotiation_status ?? null,
        negotiation_public_id: row.negotiation_public_id ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })),
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

export const portalDashboardRouter = Router();
portalDashboardRouter.use(authenticateCustomer);

const getDashboardHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customerId = (req as any).customer.customerId;

    const custResult = await query(
      `SELECT c.id, c.name, c.email, c.company, c.status, c.currency_code, c.payment_terms,
              c.credit_limit, c.billing_address, c.shipping_address, t.name as tier_name
       FROM customers c
       LEFT JOIN customer_tiers t ON c.tier_id = t.id
       WHERE c.id = $1`,
      [customerId]
    );

    if (custResult.rows.length === 0) {
      throw new NotFoundError("Customer", customerId);
    }

    const customer = custResult.rows[0];
    const currency = customer.currency_code || "USD";

    const quotesResult = await query(
      `SELECT
         COUNT(*) as total_quotations,
         COUNT(*) FILTER (WHERE status IN ('APPROVED', 'NEGOTIATION', 'PENDING_REAPPROVAL', 'PENDING_APPROVAL', 'DRAFT', 'SENT')) as active_quotations,
         COUNT(*) FILTER (WHERE status IN ('APPROVED', 'SENT')) as pending_confirmations
       FROM quotations WHERE customer_id = $1`,
      [customerId]
    );

    const subsResult = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'ACTIVE') as active_subscriptions_count,
         COALESCE(SUM(quantity * unit_price) FILTER (WHERE status = 'ACTIVE'), 0) as mrr_total
       FROM subscriptions WHERE customer_id = $1`,
      [customerId]
    );

    const invResult = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('ISSUED', 'PARTIALLY_PAID')) as unpaid_invoices_count,
         COALESCE(SUM(grand_total - total_paid) FILTER (WHERE status IN ('ISSUED', 'PARTIALLY_PAID')), 0) as unpaid_balance_total
       FROM invoices WHERE customer_id = $1`,
      [customerId]
    );

    const wallet = await getOrCreateWallet(null, customerId, currency);

    const recentQuotesResult = await query(
      `SELECT id, public_id, quotation_number, status, grand_total, created_at
       FROM quotations
       WHERE customer_id = $1
       ORDER BY created_at DESC
       LIMIT 5`,
      [customerId]
    );

    const qRow = quotesResult.rows[0] || {};
    const sRow = subsResult.rows[0] || {};
    const iRow = invResult.rows[0] || {};

    res.json({
      data: {
        customer: {
          id: Number(customer.id),
          name: customer.name,
          email: customer.email,
          company: customer.company ?? null,
          status: customer.status,
          currency_code: customer.currency_code,
          payment_terms: customer.payment_terms,
          credit_limit: Number(customer.credit_limit || 0),
          billing_address: customer.billing_address ?? null,
          shipping_address: customer.shipping_address ?? null,
          tier_name: customer.tier_name || "STANDARD",
        },
        metrics: {
          total_quotations: parseInt(qRow.total_quotations || "0"),
          active_quotations: parseInt(qRow.active_quotations || "0"),
          pending_confirmations: parseInt(qRow.pending_confirmations || "0"),
          unpaid_invoices_count: parseInt(iRow.unpaid_invoices_count || "0"),
          unpaid_balance_total: Number(iRow.unpaid_balance_total || 0),
          active_subscriptions_count: parseInt(sRow.active_subscriptions_count || "0"),
          mrr_total: Number(sRow.mrr_total || 0),
          wallet_balance: wallet.balance,
        },
        recent_quotations: recentQuotesResult.rows.map((row: any) => ({
          id: Number(row.id),
          public_id: row.public_id,
          quotation_number: row.quotation_number,
          status: row.status,
          revision_number: 1,
          grand_total: Number(row.grand_total),
          valid_until: null,
          created_at: row.created_at,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/portal/dashboard & GET /api/v1/portal/quotations/dashboard
portalDashboardRouter.get("/", getDashboardHandler);
quotationsPortalRouter.get("/dashboard", getDashboardHandler);

// GET /api/v1/portal/quotations/:publicId — customer-safe single quotation detail
quotationsPortalRouter.get("/:publicId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customerId = (req as any).customer.customerId;
    const { publicId } = req.params;

    const quoteResult = await query(
      `SELECT q.id, q.quotation_number, q.public_id, q.customer_id, c.name as customer_name,
              c.company as customer_company, q.currency_code, q.status, q.subtotal, q.discount_total,
              q.order_discount_pct, q.order_discount_amount, q.tax_rate_pct, q.tax_total, q.grand_total,
              q.notes, q.created_at, q.updated_at,
              n.status as negotiation_status, n.id as negotiation_id, q.public_id as negotiation_public_id
       FROM quotations q
       JOIN customers c ON q.customer_id = c.id
       LEFT JOIN negotiations n ON n.quotation_id = q.id
       WHERE q.public_id::text = $1`,
      [publicId]
    );

    if (quoteResult.rows.length === 0) {
      throw new NotFoundError("Quotation", publicId);
    }

    const quote = quoteResult.rows[0];

    if (Number(quote.customer_id) !== Number(customerId)) {
      throw new NotFoundError("Quotation", publicId);
    }

    const linesResult = await query(
      `SELECT ql.id, ql.product_id, p.name as product_name, p.sku as product_sku, p.product_type,
              ql.product_variant_id, pv.name as variant_name, ql.description, ql.quantity,
              ql.unit_price, ql.applied_discount_pct, ql.discount_amount,
              ql.line_subtotal, ql.line_total
       FROM quotation_lines ql
       JOIN products p ON ql.product_id = p.id
       LEFT JOIN product_variants pv ON ql.product_variant_id = pv.id
       WHERE ql.quotation_id = $1
       ORDER BY ql.id ASC`,
      [quote.id]
    );

    let openRequestsCount = 0;
    if (quote.negotiation_id) {
      const reqCount = await query(
        `SELECT COUNT(*) FROM negotiation_requests WHERE negotiation_id = $1 AND status = 'PENDING'`,
        [quote.negotiation_id]
      );
      openRequestsCount = parseInt(reqCount.rows[0].count);
    }

    const isApproved = quote.status === "APPROVED";
    const canConfirm = isApproved && openRequestsCount === 0;
    const canNegotiate = quote.status === "APPROVED" || quote.status === "NEGOTIATION";

    res.json({
      data: {
        id: Number(quote.id),
        public_id: quote.public_id,
        quotation_number: quote.quotation_number,
        customer_name: quote.customer_name,
        customer_company: quote.customer_company,
        currency_code: quote.currency_code,
        status: quote.status,
        subtotal: Number(quote.subtotal),
        discount_total: Number(quote.discount_total),
        order_discount_pct: Number(quote.order_discount_pct || 0),
        tax_rate_pct: Number(quote.tax_rate_pct),
        tax_total: Number(quote.tax_total),
        grand_total: Number(quote.grand_total),
        notes: quote.notes,
        created_at: quote.created_at,
        updated_at: quote.updated_at,
        negotiation_status: quote.negotiation_status ?? null,
        negotiation_public_id: quote.negotiation_public_id ?? null,
        open_negotiation_requests: openRequestsCount,
        can_confirm: canConfirm,
        can_negotiate: canNegotiate,
        lines: linesResult.rows.map((l: any) => ({
          id: Number(l.id),
          product_id: Number(l.product_id),
          product_name: l.product_name,
          product_sku: l.product_sku,
          product_type: l.product_type,
          billing_model: l.product_type,
          variant_name: l.variant_name ?? null,
          description: l.description,
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price),
          applied_discount_pct: Number(l.applied_discount_pct),
          discount_amount: Number(l.discount_amount),
          line_subtotal: Number(l.line_subtotal),
          line_total: Number(l.line_total),
          plan_name: null,
          billing_cycle: null,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/portal/quotations/:publicId/confirm — customer quotation confirmation
quotationsPortalRouter.post("/:publicId/confirm", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customerId = (req as any).customer.customerId;
    const { publicId } = req.params;

    const quoteResult = await query(
      `SELECT id, customer_id, status FROM quotations WHERE public_id::text = $1`,
      [publicId]
    );

    if (quoteResult.rows.length === 0) {
      throw new NotFoundError("Quotation", publicId);
    }

    const quote = quoteResult.rows[0];

    if (Number(quote.customer_id) !== Number(customerId)) {
      throw new NotFoundError("Quotation", publicId);
    }

    await executeQuotationConfirmation(quote.id, null, "Confirmed by customer via Customer Portal");

    const refreshedResult = await query(
      `SELECT q.id, q.public_id, q.quotation_number, q.status, q.currency_code, q.grand_total, q.updated_at
       FROM quotations q WHERE q.id = $1`,
      [quote.id]
    );
    const row = refreshedResult.rows[0];

    res.json({
      data: {
        id: Number(row.id),
        public_id: row.public_id,
        quotation_number: row.quotation_number,
        status: row.status,
        currency_code: row.currency_code,
        grand_total: Number(row.grand_total),
        updated_at: row.updated_at,
      },
    });
  } catch (err) {
    next(err);
  }
});
