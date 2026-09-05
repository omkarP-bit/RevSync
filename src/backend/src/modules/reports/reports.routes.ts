import { Router, Request, Response, NextFunction } from "express";
import { query } from "../../database/pool.js";
import { authenticate, requireRole, ROLES } from "../../middleware/auth.js";
import { ValidationError } from "../../shared/errors.js";
import { z } from "zod";

export const reportsRouter = Router();
reportsRouter.use(authenticate);

const REPORT_ROLES = [
  ROLES.ADMIN,
  ROLES.FINANCE,
  ROLES.SALES_MANAGER,
  ROLES.WAREHOUSE_MANAGER,
  ROLES.SALES_REP,
] as const;

const periodSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD").optional(),
});

function buildPeriodQuery(
  params: z.infer<typeof periodSchema>,
  varStart: string,
  varEnd: string,
  column: string
): { clause: string; params: (string | null)[]; from: string; to: string } {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const from = params.from ?? defaultFrom.toISOString().slice(0, 10);
  const to = params.to ?? now.toISOString().slice(0, 10);
  const clause = `(${column} >= ($${varStart})::date AND ${column} < (($${varEnd})::date + INTERVAL '1 day'))`;
  return { clause, params: [from, to], from, to };
}

const num = (v: any): number => Number(v ?? 0);

// GET /api/v1/reports/overview — top-line KPIs across pipeline, revenue, fulfillment, subscriptions, deal health
reportsRouter.get("/overview", requireRole(...REPORT_ROLES), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const quoteAgg = await query(
      `SELECT
         COUNT(*)::int AS total_count,
         COUNT(*) FILTER (WHERE status = 'CONFIRMED')::int AS confirmed_count,
         SUM(grand_total) FILTER (WHERE status = 'CONFIRMED') AS confirmed_value,
         SUM(grand_total) FILTER (WHERE status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'NEGOTIATION')) AS open_value
       FROM quotations
       WHERE status <> 'CANCELLED'`
    );
    const invoiceAgg = await query(
      `SELECT
         COUNT(*)::int AS total_count,
         SUM(grand_total) AS invoiced,
         SUM(total_paid) AS collected,
         SUM(grand_total - total_paid) AS outstanding,
         COUNT(*) FILTER (WHERE status IN ('ISSUED', 'PARTIALLY_PAID') AND due_date < NOW())::int AS overdue_count
       FROM invoices
       WHERE status <> 'CANCELLED'`
    );
    const fulfillmentAgg = await query(
      `SELECT
         COUNT(*)::int AS orders_total,
         COUNT(*) FILTER (WHERE status = 'PARTIAL')::int AS partial_count,
         COALESCE(SUM(backordered_quantity) FILTER (WHERE status IN ('PARTIAL', 'BACKORDERED')), 0) AS units_backordered
       FROM fulfillment_orders`
    );
    const subscriptionAgg = await query(
      `SELECT
         COUNT(*)::int AS active_count,
         COALESCE(SUM(CASE
           WHEN sp.billing_cycle = 'MONTHLY' THEN s.unit_price * s.quantity
           WHEN sp.billing_cycle = 'QUARTERLY' THEN s.unit_price * s.quantity / 3
           WHEN sp.billing_cycle = 'YEARLY' THEN s.unit_price * s.quantity / 12
           ELSE s.unit_price * s.quantity END), 0) AS mrr
       FROM subscriptions s
       JOIN subscription_plans sp ON sp.id = s.subscription_plan_id
       WHERE s.status = 'ACTIVE'`
    );
    const healthAgg = await query(
      `SELECT status, COUNT(*)::int AS count FROM deal_health_snapshots GROUP BY status`
    );
    const currencyAgg = await query(
      `SELECT currency_code, COUNT(*)::int AS cnt FROM (
         SELECT currency_code FROM invoices WHERE status <> 'CANCELLED'
         UNION ALL
         SELECT currency_code FROM quotations WHERE status <> 'CANCELLED'
       ) all_rows GROUP BY currency_code ORDER BY cnt DESC LIMIT 1`
    );

    const q = quoteAgg.rows[0];
    const inv = invoiceAgg.rows[0];
    const totalQuotes = num(q.total_count);
    const won = num(q.confirmed_count);
    const open = num(q.open_value);
    const invoiced = num(inv.invoiced);
    const collected = num(inv.collected);
    const outstanding = num(inv.outstanding);

    res.json({
      data: {
        base_currency: currencyAgg.rows[0]?.currency_code ?? "USD",
        pipeline: {
          total_quotations: totalQuotes,
          confirmed_count: won,
          open_count: open > 0 || totalQuotes > 0 ? totalQuotes - num(q.confirmed_count) : 0,
          open_value: open,
          confirmed_value: num(q.confirmed_value),
          win_rate: totalQuotes > 0 ? Math.round((won / totalQuotes) * 1000) / 10 : 0,
        },
        revenue: {
          invoiced: invoiced,
          collected: collected,
          outstanding: Math.max(outstanding, 0),
          overdue_count: num(inv.overdue_count),
        },
        fulfillment: {
          orders_total: num(fulfillmentAgg.rows[0]?.orders_total),
          partial_count: num(fulfillmentAgg.rows[0]?.partial_count),
          units_backordered: num(fulfillmentAgg.rows[0]?.units_backordered),
        },
        subscriptions: {
          active_count: num(subscriptionAgg.rows[0]?.active_count),
          monthly_recurring_value: num(subscriptionAgg.rows[0]?.mrr),
        },
        deal_health: {
          healthy: num(healthAgg.rows.find((r: any) => r.status === "HEALTHY")?.count),
          at_risk: num(healthAgg.rows.find((r: any) => r.status === "AT_RISK")?.count),
          critical: num(healthAgg.rows.find((r: any) => r.status === "CRITICAL")?.count),
        },
      },
      meta: { generated_at: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/reports/revenue?from&to — monthly invoiced / collected / outstanding series
reportsRouter.get("/revenue", requireRole(...REPORT_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = periodSchema.parse(req.query);
    const { clause, params, from, to } = buildPeriodQuery(period, "1", "2", "i.issue_date");
    const series = await query(
      `SELECT
         to_char(i.issue_date, 'YYYY-MM') AS period,
         SUM(i.grand_total)::numeric AS invoiced,
         SUM(i.total_paid)::numeric AS collected,
         SUM(i.grand_total - i.total_paid)::numeric AS outstanding
       FROM invoices i
       WHERE i.status <> 'CANCELLED' AND ${clause}
       GROUP BY period
       ORDER BY period ASC`,
      params
    );
    const payments = await query(
      `SELECT
         to_char(p.payment_date, 'YYYY-MM') AS period,
         SUM(p.amount_paid)::numeric AS collected
       FROM invoice_payments p
       JOIN invoices i ON i.id = p.invoice_id
       WHERE i.status <> 'CANCELLED' AND (p.payment_date >= ($1)::date AND p.payment_date < (($2)::date + INTERVAL '1 day'))
       GROUP BY period
       ORDER BY period ASC`,
      params
    );
    const currencyAgg = await query(
      `SELECT currency_code, COUNT(*)::int AS cnt FROM invoices WHERE status <> 'CANCELLED' GROUP BY currency_code ORDER BY cnt DESC LIMIT 1`
    );

    const byPeriod = new Map<string, { invoiced: number; collected: number; outstanding: number }>();
    for (const r of series.rows) {
      byPeriod.set(r.period, { invoiced: num(r.invoiced), collected: num(r.collected), outstanding: num(r.outstanding) });
    }
    for (const r of payments.rows) {
      const cur = byPeriod.get(r.period) ?? { invoiced: 0, collected: 0, outstanding: 0 };
      cur.collected += num(r.collected);
      if (cur.outstanding > 0) cur.outstanding = Math.max(cur.outstanding - num(r.collected), 0);
      byPeriod.set(r.period, cur);
    }

    const months: { period: string; invoiced: number; collected: number; outstanding: number }[] = [];
    const range = buildMonthRange(from, to);
    for (const m of range) {
      const cur = byPeriod.get(m);
      months.push({ period: m, invoiced: cur?.invoiced ?? 0, collected: cur?.collected ?? 0, outstanding: cur?.outstanding ?? 0 });
    }

    res.json({
      data: {
        base_currency: currencyAgg.rows[0]?.currency_code ?? "USD",
        from,
        to,
        months,
      },
      meta: { generated_at: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/reports/sales?from&to — sales rep rankings + top customers
reportsRouter.get("/sales", requireRole(...REPORT_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = periodSchema.parse(req.query);
    const { clause, params, from, to } = buildPeriodQuery(period, "1", "2", "q.created_at");
    const reps = await query(
      `SELECT
         u.id AS sales_rep_id,
         CONCAT(u.first_name, ' ', u.last_name) AS sales_rep_name,
         COUNT(*)::int AS quotation_count,
         COALESCE(SUM(q.grand_total) FILTER (WHERE q.status = 'CONFIRMED'), 0) AS confirmed_value,
         COUNT(*) FILTER (WHERE q.status = 'CONFIRMED')::int AS confirmed_count,
         COALESCE(SUM(q.grand_total), 0) AS pipeline_value
       FROM quotations q
       JOIN users u ON u.id = q.sales_rep_id
       WHERE q.status <> 'CANCELLED' AND ${clause}
       GROUP BY u.id, u.first_name, u.last_name
       ORDER BY confirmed_value DESC, pipeline_value DESC`,
      params
    );
    const customers = await query(
      `SELECT
         c.id AS customer_id,
         c.name AS customer_name,
         c.company,
         COUNT(*)::int AS invoice_count,
         COALESCE(SUM(i.grand_total), 0) AS invoiced,
         COALESCE(SUM(i.total_paid), 0) AS collected,
         COUNT(DISTINCT CASE WHEN i.status IN ('ISSUED', 'PARTIALLY_PAID') AND i.due_date < NOW() THEN i.id END)::int AS overdue_count
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       WHERE i.status <> 'CANCELLED' AND (i.issue_date >= ($1)::date AND i.issue_date < (($2)::date + INTERVAL '1 day'))
       GROUP BY c.id, c.name, c.company
       ORDER BY invoiced DESC
       LIMIT 10`,
      params
    );

    res.json({
      data: {
        from,
        to,
        sales_reps: reps.rows.map((r: any) => ({
          sales_rep_id: Number(r.sales_rep_id),
          sales_rep_name: r.sales_rep_name,
          quotation_count: Number(r.quotation_count),
          confirmed_count: Number(r.confirmed_count),
          confirmed_value: Number(r.confirmed_value),
          pipeline_value: Number(r.pipeline_value),
        })),
        top_customers: customers.rows.map((r: any) => ({
          customer_id: Number(r.customer_id),
          customer_name: r.customer_name,
          company: r.company,
          invoice_count: Number(r.invoice_count),
          invoiced: Number(r.invoiced),
          collected: Number(r.collected),
          overdue_count: Number(r.overdue_count),
        })),
      },
      meta: { generated_at: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/reports/pipeline?from&to — quotation funnel by status
reportsRouter.get("/pipeline", requireRole(...REPORT_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = periodSchema.parse(req.query);
    const { clause, params, from, to } = buildPeriodQuery(period, "1", "2", "q.created_at");
    const funnel = await query(
      `SELECT
         q.status,
         COUNT(*)::int AS count,
         COALESCE(SUM(q.grand_total), 0) AS value
       FROM quotations q
       WHERE ${clause}
       GROUP BY q.status
       ORDER BY MIN(q.created_at) ASC`,
      params
    );

    const statusOrder = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "NEGOTIATION", "REJECTED", "CONFIRMED", "CANCELLED"];

    res.json({
      data: {
        from,
        to,
        count: funnel.rows.reduce((acc: number, r: any) => acc + Number(r.count), 0),
        value: funnel.rows.reduce((acc: number, r: any) => acc + Number(r.value), 0),
        statuses: statusOrder
          .filter((s) => funnel.rows.some((r: any) => r.status === s))
          .map((s) => {
            const row = funnel.rows.find((r: any) => r.status === s);
            const val = Number(row?.value ?? 0);
            const count = Number(row?.count ?? 0);
            return { status: s, count, value: val, avg_ticket: count > 0 ? Math.round((val / count) * 100) / 100 : 0 };
          }),
      },
      meta: { generated_at: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

function buildMonthRange(from: string, to: string): string[] {
  const months: string[] = [];
  const start = new Date(`${from}Z`);
  const end = new Date(`${to}Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new ValidationError("Invalid date range");
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last) {
    months.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}