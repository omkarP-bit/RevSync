import { Router, Request, Response, NextFunction } from "express";
import { query } from "../../database/pool.js";
import { authenticate, requireRole, ROLES } from "../../middleware/auth.js";
import { NotFoundError, ValidationError } from "../../shared/errors.js";
import { writeAuditLog } from "../../shared/audit.js";
import {
  evaluateDealHealth,
  DealHealthInput,
  SignalConfig,
  DEAL_HEALTH_SIGNALS,
  DealSignalKey,
} from "../../engines/deal-health-engine.js";
import { z } from "zod";

export const dealHealthRouter = Router();
dealHealthRouter.use(authenticate);

const VIEW_ROLES = [ROLES.ADMIN, ROLES.FINANCE, ROLES.SALES_MANAGER, ROLES.SALES_REP] as const;
const MANAGE_ROLES = [ROLES.ADMIN, ROLES.FINANCE, ROLES.SALES_MANAGER] as const;
const CONFIG_ROLES = [ROLES.ADMIN, ROLES.SALES_MANAGER] as const;

const HEALTH_STATUSES = ["HEALTHY", "AT_RISK", "CRITICAL"] as const;
const SIGNAL_KEYS = DEAL_HEALTH_SIGNALS.map((s) => s.key);

const configUpdateSchema = z.object({
  weight: z.coerce.number().min(0).max(100).optional(),
  is_enabled: z.boolean().optional(),
});

// GET /api/v1/deal-health/config — signal weights & enabled flags (Admin / Sales Manager)
dealHealthRouter.get("/config", requireRole(...CONFIG_ROLES), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await query(
      `SELECT signal_key, name, description, weight, is_enabled, updated_at
       FROM deal_health_signal_config
       ORDER BY id ASC`
    );
    res.json({
      data: result.rows.map((row: any) => ({
        key: row.signal_key,
        name: row.name,
        description: row.description,
        weight: Number(row.weight),
        is_enabled: row.is_enabled,
        updated_at: row.updated_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/deal-health/config/:key — update a signal weight / enabled flag (Admin / Sales Manager)
dealHealthRouter.patch("/config/:key", requireRole(...CONFIG_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { key } = req.params;
    if (!SIGNAL_KEYS.includes(key as DealSignalKey)) {
      throw new ValidationError("Unknown signal key");
    }
    const data = configUpdateSchema.parse(req.body);
    const sets: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (data.weight !== undefined) {
      sets.push(`weight = $${paramIdx++}`);
      values.push(data.weight);
    }
    if (data.is_enabled !== undefined) {
      sets.push(`is_enabled = $${paramIdx++}`);
      values.push(data.is_enabled);
    }
    if (sets.length === 0) {
      throw new ValidationError("No fields to update");
    }
    values.push(key);

    const result = await query(
      `UPDATE deal_health_signal_config
       SET ${sets.join(", ")}, updated_at = NOW()
       WHERE signal_key = $${paramIdx}
       RETURNING signal_key, name, weight, is_enabled`,
      values
    );
    if (result.rows.length === 0) {
      throw new NotFoundError("Deal health signal", key);
    }

    await writeAuditLog({
      entityType: "deal_health_signal_config",
      entityId: key,
      action: "DEAL_HEALTH_SIGNAL_UPDATED",
      before: null,
      after: {
        weight: Number(result.rows[0].weight),
        is_enabled: result.rows[0].is_enabled,
      },
      performedBy: (req as any).user.userId,
      reason: "Deal health signal configuration changed",
    });

    res.json({
      data: {
        key: result.rows[0].signal_key,
        name: result.rows[0].name,
        weight: Number(result.rows[0].weight),
        is_enabled: result.rows[0].is_enabled,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/deal-health/refresh — recompute snapshots for every non-terminal quotation
dealHealthRouter.post("/refresh", requireRole(...MANAGE_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;

    const configResult = await query(
      `SELECT signal_key, weight, is_enabled FROM deal_health_signal_config ORDER BY id ASC`
    );
    const configs: SignalConfig[] = configResult.rows.map((row: any) => ({
      key: row.signal_key as DealSignalKey,
      weight: Number(row.weight),
      enabled: row.is_enabled,
    }));

    const dealResult = await query(
      `SELECT q.id AS quotation_id, q.status, q.risk_level, q.margin_pct, q.updated_at,
              q.customer_id, q.sales_rep_id,
              (SELECT MIN(ar.submitted_at)
                 FROM approval_requests ar
                 WHERE ar.quotation_id = q.id AND ar.status = 'PENDING_APPROVAL') AS pending_since,
              (SELECT COALESCE(SUM(fo.backordered_quantity), 0)::int
                 FROM fulfillment_orders fo
                 WHERE fo.quotation_id = q.id) AS backordered_qty,
              (SELECT COALESCE(SUM(ql.quantity), 0)::int
                 FROM quotation_lines ql
                 WHERE ql.quotation_id = q.id) AS requested_qty,
              (SELECT MIN(n.created_at)
                 FROM negotiations n
                 WHERE n.quotation_id = q.id AND n.status = 'OPEN') AS open_negotiation_since
       FROM quotations q
       WHERE q.status NOT IN ('CANCELLED', 'REJECTED')
       ORDER BY q.id ASC`
    );

    const now = new Date();
    for (const quote of dealResult.rows as any[]) {
      const input: DealHealthInput = {
        quotationStatus: quote.status,
        riskLevel: quote.risk_level ?? "LOW",
        marginPct: Number(quote.margin_pct ?? 0),
        lastUpdatedAt: quote.updated_at ? new Date(quote.updated_at) : now,
        pendingApprovalSince: quote.pending_since ? new Date(quote.pending_since) : null,
        backorderedQuantity: Number(quote.backordered_qty ?? 0),
        requestedQuantity: Number(quote.requested_qty ?? 0),
        openNegotiationSince: quote.open_negotiation_since ? new Date(quote.open_negotiation_since) : null,
        now,
      };

      const assessment = evaluateDealHealth(input, configs);

      await query(
        `INSERT INTO deal_health_snapshots
           (quotation_id, customer_id, sales_rep_id, status, score, signals, computed_by)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
         ON CONFLICT (quotation_id)
         DO UPDATE SET status = $4, score = $5, signals = $6::jsonb,
                       computed_by = $7, computed_at = NOW()`,
        [
          Number(quote.quotation_id),
          Number(quote.customer_id),
          quote.sales_rep_id ? Number(quote.sales_rep_id) : null,
          assessment.status,
          assessment.score.toFixed(2),
          JSON.stringify(assessment.signals),
          userId,
        ]
      );
    }

    await writeAuditLog({
      entityType: "deal_health_snapshots",
      entityId: "all",
      action: "DEAL_HEALTH_REFRESHED",
      before: null,
      after: { deals_evaluated: dealResult.rows.length, signal_weight_sum: configs.reduce((s, c) => s + c.weight, 0) },
      performedBy: userId,
      reason: "Recomputed deal health snapshots",
    });

    const countsResult = await query(
      `SELECT status, COUNT(*)::int AS count FROM deal_health_snapshots GROUP BY status`
    );
    const counts: Record<string, number> = { HEALTHY: 0, AT_RISK: 0, CRITICAL: 0 };
    for (const row of countsResult.rows as any[]) {
      counts[row.status] = Number(row.count);
    }

    res.json({
      data: {
        refreshed: dealResult.rows.length,
        counts,
        total: Object.values(counts).reduce((a, b) => a + b, 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

async function loadSnapshot(id: string): Promise<any> {
  const result = await query(
    `SELECT dh.id, dh.public_id, dh.quotation_id, dh.customer_id, dh.sales_rep_id,
            dh.status, dh.score, dh.signals, dh.computed_at,
            q.quotation_number, c.name AS customer_name,
            u.email AS sales_rep_email
     FROM deal_health_snapshots dh
     JOIN quotations q ON dh.quotation_id = q.id
     JOIN customers c ON dh.customer_id = c.id
     LEFT JOIN users u ON dh.sales_rep_id = u.id
     WHERE dh.id = $1`,
    [id]
  );
  if (result.rows.length === 0) {
    throw new NotFoundError("Deal health snapshot", id);
  }
  const row = result.rows[0];
  return {
    id: Number(row.id),
    public_id: row.public_id,
    quotation_id: Number(row.quotation_id),
    quotation_number: row.quotation_number,
    customer_id: Number(row.customer_id),
    customer_name: row.customer_name,
    sales_rep_id: row.sales_rep_id ? Number(row.sales_rep_id) : null,
    sales_rep_email: row.sales_rep_email,
    status: row.status,
    score: Number(row.score),
    signals: row.signals,
    computed_at: row.computed_at,
  };
}

// GET /api/v1/deal-health — list snapshots (paginated)
dealHealthRouter.get("/", requireRole(...VIEW_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (req.query.status) {
      const status = (req.query.status as string).toUpperCase().replace(" ", "_");
      if (!(HEALTH_STATUSES as readonly string[]).includes(status)) {
        throw new ValidationError("Invalid deal health status");
      }
      where.push(`dh.status = $${paramIdx++}`);
      params.push(status);
    }
    if (req.query.customer_id) {
      where.push(`dh.customer_id = $${paramIdx++}`);
      params.push(parseInt(req.query.customer_id as string));
    }
    if (req.query.sales_rep_id) {
      where.push(`dh.sales_rep_id = $${paramIdx++}`);
      params.push(parseInt(req.query.sales_rep_id as string));
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const countResult = await query(
      `SELECT COUNT(*) FROM deal_health_snapshots dh ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT dh.id, dh.quotation_id, dh.status, dh.score, dh.computed_at,
              q.quotation_number, c.name AS customer_name,
              u.email AS sales_rep_email
       FROM deal_health_snapshots dh
       JOIN quotations q ON dh.quotation_id = q.id
       JOIN customers c ON dh.customer_id = c.id
       LEFT JOIN users u ON dh.sales_rep_id = u.id
       ${whereClause}
       ORDER BY dh.score DESC, dh.id ASC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    res.json({
      data: result.rows.map((row: any) => ({
        id: Number(row.id),
        quotation_id: Number(row.quotation_id),
        quotation_number: row.quotation_number,
        customer_name: row.customer_name,
        sales_rep_email: row.sales_rep_email,
        status: row.status,
        score: Number(row.score),
        computed_at: row.computed_at,
      })),
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/deal-health/overview — summary counts per status
dealHealthRouter.get("/overview", requireRole(...VIEW_ROLES), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await query(
      `SELECT status, COUNT(*)::int AS count,
              ROUND(AVG(score)::numeric, 2) AS avg_score
       FROM deal_health_snapshots
       GROUP BY status`
    );
    const counts: Record<string, number> = { HEALTHY: 0, AT_RISK: 0, CRITICAL: 0 };
    let totalScore = 0;
    let snapshotCount = 0;
    for (const row of result.rows as any[]) {
      counts[row.status] = Number(row.count);
      totalScore += Number(row.count) * (row.avg_score === null ? 0 : Number(row.avg_score));
      snapshotCount += Number(row.count);
    }
    res.json({
      data: {
        counts,
        total: snapshotCount,
        avg_score: snapshotCount > 0 ? Math.round((totalScore / snapshotCount) * 100) / 100 : 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/deal-health/:id — snapshot detail with signal breakdown
dealHealthRouter.get("/:id", requireRole(...VIEW_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ data: await loadSnapshot(req.params.id) });
  } catch (err) {
    next(err);
  }
});