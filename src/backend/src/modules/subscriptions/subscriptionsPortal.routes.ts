import { Router, Request, Response, NextFunction } from "express";
import { query } from "../../database/pool.js";
import { authenticateCustomer } from "../../middleware/customerAuth.js";
import { NotFoundError, ForbiddenError } from "../../shared/errors.js";
import { getOrCreateWallet } from "../../engines/wallet-engine.js";

export const subscriptionsPortalRouter = Router();
subscriptionsPortalRouter.use(authenticateCustomer);

export const walletPortalRouter = Router();
walletPortalRouter.use(authenticateCustomer);

// GET /api/v1/portal/subscriptions — authenticated customer's subscriptions
subscriptionsPortalRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customerId = (req as any).customer.customerId;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const countResult = await query(
      `SELECT COUNT(*) FROM subscriptions WHERE customer_id = $1`,
      [customerId]
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT s.id, s.public_id, s.customer_id, s.quotation_id, s.subscription_plan_id, s.product_id,
              s.status, s.quantity, s.unit_price, s.currency, s.start_date, s.end_date,
              s.current_period_start, s.current_period_end, s.next_billing_date, s.created_at,
              p.name AS product_name, p.sku, sp.name AS plan_name, sp.billing_cycle
       FROM subscriptions s
       JOIN products p ON s.product_id = p.id
       LEFT JOIN subscription_plans sp ON s.subscription_plan_id = sp.id
       WHERE s.customer_id = $1
       ORDER BY s.created_at DESC
       LIMIT $2 OFFSET $3`,
      [customerId, limit, offset]
    );

    res.json({
      data: result.rows.map((row: any) => ({
        id: Number(row.id),
        public_id: row.public_id,
        plan_name: row.plan_name || row.product_name,
        product_name: row.product_name,
        sku: row.sku,
        status: row.status,
        quantity: Number(row.quantity),
        unit_price: Number(row.unit_price),
        recurring_amount: Number((Number(row.unit_price) * Number(row.quantity)).toFixed(4)),
        currency: row.currency,
        billing_cycle: row.billing_cycle || "MONTHLY",
        start_date: row.start_date,
        end_date: row.end_date,
        current_period_start: row.current_period_start,
        current_period_end: row.current_period_end,
        next_billing_date: row.next_billing_date,
        created_at: row.created_at,
      })),
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/portal/subscriptions/:id — customer subscription detail
subscriptionsPortalRouter.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customerId = (req as any).customer.customerId;
    const { id } = req.params;

    const subResult = await query(
      `SELECT s.id, s.public_id, s.customer_id, s.quotation_id, s.subscription_plan_id, s.product_id,
              s.status, s.quantity, s.unit_price, s.currency, s.start_date, s.end_date,
              s.current_period_start, s.current_period_end, s.next_billing_date, s.created_at, s.updated_at,
              p.name AS product_name, p.sku, sp.name AS plan_name, sp.billing_cycle, q.quotation_number
       FROM subscriptions s
       JOIN products p ON s.product_id = p.id
       LEFT JOIN subscription_plans sp ON s.subscription_plan_id = sp.id
       LEFT JOIN quotations q ON s.quotation_id = q.id
       WHERE (s.id = $1 OR s.public_id::text = $1) AND s.customer_id = $2`,
      [id, customerId]
    );

    if (subResult.rows.length === 0) {
      throw new NotFoundError("Subscription", id);
    }
    const sub = subResult.rows[0];
    const subId = Number(sub.id);

    const schedResult = await query(
      `SELECT bs.id, bs.billing_date, bs.period_start, bs.period_end, bs.amount, bs.status, i.invoice_number
       FROM billing_schedules bs
       LEFT JOIN invoices i ON bs.invoice_id = i.id
       WHERE bs.subscription_id = $1
       ORDER BY bs.period_start ASC`,
      [subId]
    );

    const invoicesResult = await query(
      `SELECT i.id, i.invoice_number, i.invoice_type, i.status, i.grand_total, i.wallet_offset_amount,
              i.total_paid, i.issue_date, i.due_date
       FROM invoices i
       WHERE i.subscription_id = $1
       ORDER BY i.created_at DESC`,
      [subId]
    );

    res.json({
      data: {
        id: subId,
        public_id: sub.public_id,
        quotation_number: sub.quotation_number,
        plan_name: sub.plan_name || sub.product_name,
        product_name: sub.product_name,
        sku: sub.sku,
        status: sub.status,
        quantity: Number(sub.quantity),
        unit_price: Number(sub.unit_price),
        recurring_amount: Number((Number(sub.unit_price) * Number(sub.quantity)).toFixed(4)),
        currency: sub.currency,
        billing_cycle: sub.billing_cycle || "MONTHLY",
        start_date: sub.start_date,
        end_date: sub.end_date,
        current_period_start: sub.current_period_start,
        current_period_end: sub.current_period_end,
        next_billing_date: sub.next_billing_date,
        created_at: sub.created_at,
        schedules: schedResult.rows.map((row: any) => ({
          id: Number(row.id),
          billing_date: row.billing_date,
          period_start: row.period_start,
          period_end: row.period_end,
          amount: Number(row.amount),
          status: row.status,
          invoice_number: row.invoice_number,
        })),
        invoices: invoicesResult.rows.map((row: any) => ({
          id: Number(row.id),
          invoice_number: row.invoice_number,
          invoice_type: row.invoice_type,
          status: row.status,
          grand_total: Number(row.grand_total),
          wallet_offset_amount: Number(row.wallet_offset_amount),
          total_paid: Number(row.total_paid),
          balance_due: Number((Number(row.grand_total) - Number(row.total_paid)).toFixed(4)),
          issue_date: row.issue_date,
          due_date: row.due_date,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/portal/wallet — authenticated customer's wallet & transactions
walletPortalRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customerId = (req as any).customer.customerId;
    const custResult = await query(`SELECT currency_code FROM customers WHERE id = $1`, [customerId]);
    const currency = custResult.rows[0]?.currency_code || "USD";
    const wallet = await getOrCreateWallet(null, customerId, currency);

    const txRes = await query(
      `SELECT id, type, amount, reference_type, reference_id, description, created_at
       FROM credit_transactions
       WHERE wallet_id = $1
       ORDER BY created_at DESC`,
      [wallet.id]
    );

    res.json({
      data: {
        id: wallet.id,
        balance: wallet.balance,
        currency: wallet.currency,
        created_at: wallet.created_at,
        updated_at: wallet.updated_at,
        transactions: txRes.rows.map((row: any) => ({
          id: Number(row.id),
          type: row.type,
          amount: Number(row.amount),
          reference_type: row.reference_type,
          reference_id: row.reference_id ? Number(row.reference_id) : null,
          description: row.description,
          created_at: row.created_at,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});
