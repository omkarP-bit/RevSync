import { Router, Request, Response, NextFunction } from "express";
import { query, withTransaction } from "../../database/pool.js";
import { authenticate, requireRole, ROLES } from "../../middleware/auth.js";
import { NotFoundError, ValidationError, UnprocessableEntityError } from "../../shared/errors.js";
import {
  runRecurringBillingJob,
  changeSubscription,
  cancelSubscription,
} from "../../engines/subscription-engine.js";
import { getOrCreateWallet } from "../../engines/wallet-engine.js";
import { z } from "zod";

export const subscriptionsRouter = Router();
subscriptionsRouter.use(authenticate);

const SUB_STATUSES = ["ACTIVE", "PAUSED", "CANCELLED", "EXPIRED"] as const;
const BILLING_CYCLES = ["MONTHLY", "QUARTERLY", "YEARLY"] as const;

const createPlanSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  price: z.coerce.number().positive(),
  currency: z.string().length(3).default("USD"),
  billing_cycle: z.enum(BILLING_CYCLES).default("MONTHLY"),
  cancellation_policy: z.string().optional(),
});

const changeSubscriptionSchema = z.object({
  new_plan_id: z.coerce.number().int().positive().optional(),
  new_quantity: z.coerce.number().int().positive().optional(),
});

const cancelSubscriptionSchema = z.object({
  reason: z.string().max(2000).optional(),
});

// GET /api/v1/subscriptions — list subscriptions (paginated)
subscriptionsRouter.get(
  "/",
  requireRole(ROLES.ADMIN, ROLES.FINANCE, ROLES.SALES_MANAGER, ROLES.SALES_REP),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
      const offset = (page - 1) * limit;

      const where: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (req.query.status) {
        const status = (req.query.status as string).toUpperCase();
        if (!(SUB_STATUSES as readonly string[]).includes(status)) {
          throw new ValidationError("Invalid subscription status");
        }
        where.push(`s.status = $${paramIdx++}`);
        params.push(status);
      }

      if (req.query.customer_id) {
        where.push(`s.customer_id = $${paramIdx++}`);
        params.push(parseInt(req.query.customer_id as string));
      }

      const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

      const countResult = await query(
        `SELECT COUNT(*) FROM subscriptions s ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].count);

      const result = await query(
        `SELECT s.id, s.public_id, s.customer_id, s.quotation_id, s.subscription_plan_id, s.product_id,
                s.status, s.quantity, s.unit_price, s.currency, s.start_date, s.end_date,
                s.current_period_start, s.current_period_end, s.next_billing_date, s.created_at,
                c.name AS customer_name, p.name AS product_name, p.sku,
                sp.name AS plan_name, sp.billing_cycle
         FROM subscriptions s
         JOIN customers c ON s.customer_id = c.id
         JOIN products p ON s.product_id = p.id
         LEFT JOIN subscription_plans sp ON s.subscription_plan_id = sp.id
         ${whereClause}
         ORDER BY s.created_at DESC
         LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        [...params, limit, offset]
      );

      res.json({
        data: result.rows.map((row: any) => ({
          id: Number(row.id),
          public_id: row.public_id,
          customer_id: Number(row.customer_id),
          customer_name: row.customer_name,
          quotation_id: row.quotation_id ? Number(row.quotation_id) : null,
          subscription_plan_id: row.subscription_plan_id ? Number(row.subscription_plan_id) : null,
          plan_name: row.plan_name || row.product_name,
          product_id: Number(row.product_id),
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
  }
);

// GET /api/v1/subscriptions/plans — list plans
subscriptionsRouter.get(
  "/plans",
  requireRole(ROLES.ADMIN, ROLES.FINANCE, ROLES.SALES_MANAGER, ROLES.SALES_REP),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await query(
        `SELECT id, name, description, price, currency, billing_cycle, proration_method,
                cancellation_policy, credit_allowance, credit_unit_value, is_active, created_at
         FROM subscription_plans
         WHERE is_active = true
         ORDER BY price ASC`
      );
      res.json({
        data: result.rows.map((row: any) => ({
          id: Number(row.id),
          name: row.name,
          description: row.description,
          price: Number(row.price),
          currency: row.currency,
          billing_cycle: row.billing_cycle,
          proration_method: row.proration_method,
          cancellation_policy: row.cancellation_policy,
          credit_allowance: Number(row.credit_allowance),
          credit_unit_value: Number(row.credit_unit_value),
          is_active: row.is_active,
          created_at: row.created_at,
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/subscriptions/plans — create plan (Admin)
subscriptionsRouter.post(
  "/plans",
  requireRole(ROLES.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createPlanSchema.parse(req.body);
      const insert = await query(
        `INSERT INTO subscription_plans (name, description, price, currency, billing_cycle, cancellation_policy)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [data.name, data.description || null, data.price, data.currency, data.billing_cycle, data.cancellation_policy || null]
      );
      const row = insert.rows[0];
      res.status(201).json({
        data: {
          id: Number(row.id),
          name: row.name,
          description: row.description,
          price: Number(row.price),
          currency: row.currency,
          billing_cycle: row.billing_cycle,
          proration_method: row.proration_method,
          is_active: row.is_active,
          created_at: row.created_at,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/subscriptions/run-billing-job — run recurring billing engine
subscriptionsRouter.post(
  "/run-billing-job",
  requireRole(ROLES.ADMIN, ROLES.FINANCE, ROLES.SALES_MANAGER, ROLES.SALES_REP),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await runRecurringBillingJob();
      res.json({
        message: "Recurring billing job completed successfully",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/subscriptions/:id — subscription detail
subscriptionsRouter.get(
  "/:id",
  requireRole(ROLES.ADMIN, ROLES.FINANCE, ROLES.SALES_MANAGER, ROLES.SALES_REP),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const subResult = await query(
        `SELECT s.id, s.public_id, s.customer_id, s.quotation_id, s.quotation_line_id,
                s.subscription_plan_id, s.product_id, s.status, s.quantity, s.unit_price,
                s.currency, s.start_date, s.end_date, s.current_period_start, s.current_period_end,
                s.next_billing_date, s.created_at, s.updated_at,
                c.name AS customer_name, c.email AS customer_email, q.quotation_number,
                p.name AS product_name, p.sku, sp.name AS plan_name, sp.billing_cycle
         FROM subscriptions s
         JOIN customers c ON s.customer_id = c.id
         LEFT JOIN quotations q ON s.quotation_id = q.id
         JOIN products p ON s.product_id = p.id
         LEFT JOIN subscription_plans sp ON s.subscription_plan_id = sp.id
         WHERE s.id::text = $1 OR s.public_id::text = $1`,
        [id]
      );
      if (subResult.rows.length === 0) {
        throw new NotFoundError("Subscription", id);
      }
      const sub = subResult.rows[0];
      const subId = Number(sub.id);

      // Fetch billing schedules
      const schedResult = await query(
        `SELECT bs.id, bs.billing_date, bs.period_start, bs.period_end, bs.amount,
                bs.status, bs.invoice_id, bs.created_at, i.invoice_number
         FROM billing_schedules bs
         LEFT JOIN invoices i ON bs.invoice_id = i.id
         WHERE bs.subscription_id = $1
         ORDER BY bs.period_start ASC`,
        [subId]
      );

      // Fetch subscription history / changes
      const changesResult = await query(
        `SELECT sc.id, sc.change_type, sc.old_plan_id, sc.new_plan_id, sc.old_quantity,
                sc.new_quantity, sc.effective_date, sc.old_period_value, sc.new_period_value,
                sc.remaining_days, sc.period_days, sc.proration_amount, sc.created_at,
                sp1.name AS old_plan_name, sp2.name AS new_plan_name
         FROM subscription_changes sc
         LEFT JOIN subscription_plans sp1 ON sc.old_plan_id = sp1.id
         LEFT JOIN subscription_plans sp2 ON sc.new_plan_id = sp2.id
         WHERE sc.subscription_id = $1
         ORDER BY sc.created_at DESC`,
        [subId]
      );

      // Fetch wallet balance for customer
      const wallet = await getOrCreateWallet(null, Number(sub.customer_id), sub.currency);

      // Fetch generated invoices
      const invoicesResult = await query(
        `SELECT i.id, i.invoice_number, i.invoice_type, i.status, i.grand_total,
                i.wallet_offset_amount, i.total_paid, i.issue_date, i.due_date
         FROM invoices i
         WHERE i.subscription_id = $1
         ORDER BY i.created_at DESC`,
        [subId]
      );

      res.json({
        data: {
          id: subId,
          public_id: sub.public_id,
          customer_id: Number(sub.customer_id),
          customer_name: sub.customer_name,
          customer_email: sub.customer_email,
          quotation_id: sub.quotation_id ? Number(sub.quotation_id) : null,
          quotation_number: sub.quotation_number,
          quotation_line_id: sub.quotation_line_id ? Number(sub.quotation_line_id) : null,
          subscription_plan_id: sub.subscription_plan_id ? Number(sub.subscription_plan_id) : null,
          plan_name: sub.plan_name || sub.product_name,
          product_id: Number(sub.product_id),
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
          wallet_balance: wallet.balance,
          created_at: sub.created_at,
          updated_at: sub.updated_at,
          schedules: schedResult.rows.map((row: any) => ({
            id: Number(row.id),
            billing_date: row.billing_date,
            period_start: row.period_start,
            period_end: row.period_end,
            amount: Number(row.amount),
            status: row.status,
            invoice_id: row.invoice_id ? Number(row.invoice_id) : null,
            invoice_number: row.invoice_number,
            created_at: row.created_at,
          })),
          history: changesResult.rows.map((row: any) => ({
            id: Number(row.id),
            change_type: row.change_type,
            old_plan_id: row.old_plan_id ? Number(row.old_plan_id) : null,
            old_plan_name: row.old_plan_name,
            new_plan_id: row.new_plan_id ? Number(row.new_plan_id) : null,
            new_plan_name: row.new_plan_name,
            old_quantity: Number(row.old_quantity),
            new_quantity: Number(row.new_quantity),
            effective_date: row.effective_date,
            old_period_value: Number(row.old_period_value),
            new_period_value: Number(row.new_period_value),
            remaining_days: Number(row.remaining_days),
            period_days: Number(row.period_days),
            proration_amount: Number(row.proration_amount),
            created_at: row.created_at,
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
  }
);

// POST /api/v1/subscriptions/:id/change — modify plan or quantity with proration
subscriptionsRouter.post(
  "/:id/change",
  requireRole(ROLES.ADMIN, ROLES.FINANCE, ROLES.SALES_MANAGER, ROLES.SALES_REP),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.userId;
      const data = changeSubscriptionSchema.parse(req.body);

      if (!data.new_plan_id && data.new_quantity === undefined) {
        throw new UnprocessableEntityError("Must provide new_plan_id or new_quantity");
      }

      const result = await withTransaction(async (client) => {
        return changeSubscription(client, {
          subscriptionId: parseInt(id),
          newPlanId: data.new_plan_id,
          newQuantity: data.new_quantity,
          userId,
        });
      });

      res.json({
        message: "Subscription modified successfully",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/subscriptions/:id/cancel — cancel subscription mid-cycle
subscriptionsRouter.post(
  "/:id/cancel",
  requireRole(ROLES.ADMIN, ROLES.FINANCE, ROLES.SALES_MANAGER, ROLES.SALES_REP),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.userId;
      const data = cancelSubscriptionSchema.parse(req.body ?? {});

      const result = await withTransaction(async (client) => {
        return cancelSubscription(client, {
          subscriptionId: parseInt(id),
          reason: data.reason,
          userId,
        });
      });

      res.json({
        message: "Subscription cancelled successfully. Unused prepaid balance credited to wallet.",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
);
