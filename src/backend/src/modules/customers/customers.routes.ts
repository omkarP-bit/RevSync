import { Router, Request, Response, NextFunction } from "express";
import { query } from "../../database/pool.js";
import { authenticate, requireRole, ROLES } from "../../middleware/auth.js";
import { NotFoundError, ValidationError, ConflictError } from "../../shared/errors.js";
import { writeAuditLog } from "../../shared/audit.js";
import { z } from "zod";
import {
  evaluateCustomerTier,
  CustomerTierRule,
  RecommendedTier,
} from "../../engines/customer-tier-engine.js";

export const customersRouter = Router();
customersRouter.use(authenticate);

const CUSTOMER_TYPES = ["INDIVIDUAL", "BUSINESS", "ENTERPRISE"] as const;
const PAYMENT_TERMS = ["NET_15", "NET_30", "NET_60", "ADVANCE", "COD"] as const;
const TIERS = ["BRONZE", "SILVER", "GOLD"] as const;

const customerSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  company: z.string().max(255).optional(),
  phone: z.string().max(50).optional(),
  tier_id: z.number().int().positive(),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).default("ACTIVE"),
  currency_code: z.string().length(3).default("USD"),
  customer_type: z.enum(CUSTOMER_TYPES).default("BUSINESS"),
  expected_po_value: z.number().min(0).default(0),
  payment_terms: z.enum(PAYMENT_TERMS).default("NET_30"),
  upfront_payment_pct: z.number().min(0).max(100).default(0),
});

const CUSTOMER_SELECT = `
  SELECT c.id, c.name, c.email, c.company, c.phone, c.status, c.currency_code,
         c.tier_id, ct.name as tier_name,
         c.customer_type, c.expected_po_value, c.payment_terms, c.upfront_payment_pct,
         c.created_at, c.updated_at
  FROM customers c
  LEFT JOIN customer_tiers ct ON c.tier_id = ct.id
`;

async function getCustomerOrThrow(id: string) {
  const result = await query(`${CUSTOMER_SELECT} WHERE c.id = $1`, [id]);
  if (result.rows.length === 0) {
    throw new NotFoundError("Customer", id);
  }
  return result.rows[0];
}

async function loadTierRules(): Promise<CustomerTierRule[]> {
  const result = await query(
    `SELECT id, name, target_tier, customer_type, min_expected_po_value,
            min_upfront_payment_pct, payment_terms, is_active
     FROM customer_tier_rules`
  );
  return result.rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    target_tier: r.target_tier as RecommendedTier,
    customer_type: r.customer_type ?? undefined,
    min_expected_po_value:
      r.min_expected_po_value == null ? undefined : Number(r.min_expected_po_value),
    min_upfront_payment_pct:
      r.min_upfront_payment_pct == null ? undefined : Number(r.min_upfront_payment_pct),
    payment_terms: Array.isArray(r.payment_terms) ? r.payment_terms : [],
    is_active: Boolean(r.is_active),
  }));
}

customersRouter.get("/", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (req.query.status) {
      where.push(`c.status = $${paramIdx++}`);
      params.push(req.query.status);
    }
    if (req.query.tier_id) {
      where.push(`c.tier_id = $${paramIdx++}`);
      params.push(parseInt(req.query.tier_id as string));
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const countResult = await query(`SELECT COUNT(*) FROM customers c ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `${CUSTOMER_SELECT}
       ${whereClause}
       ORDER BY c.status ASC, c.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    res.json({
      data: result.rows,
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

customersRouter.get("/:id", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customer = await getCustomerOrThrow(req.params.id);
    res.json({ data: customer });
  } catch (err) {
    next(err);
  }
});

customersRouter.post("/", requireRole(ROLES.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = customerSchema.parse(req.body);
    const result = await query(
      `INSERT INTO customers (name, email, company, phone, tier_id, status, currency_code,
                              customer_type, expected_po_value, payment_terms, upfront_payment_pct)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [data.name, data.email.toLowerCase(), data.company, data.phone, data.tier_id, data.status, data.currency_code,
       data.customer_type, data.expected_po_value, data.payment_terms, data.upfront_payment_pct]
    );

    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

customersRouter.patch("/:id", requireRole(ROLES.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const fields = customerSchema.partial().parse(req.body);
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);

    if (entries.length === 0) {
      throw new ValidationError("No fields to update");
    }

    const before = await getCustomerOrThrow(id);

    const setClauses = entries.map(([key], i) => `${key} = $${i + 1}`);
    const values = entries.map(([, v]) => v);

    const result = await query(
      `UPDATE customers SET ${setClauses.join(", ")}, updated_at = NOW()
       WHERE id = $${entries.length + 1}
       RETURNING *`,
      [...values, id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Customer", id);
    }

    await writeAuditLog({
      entityType: "customer",
      entityId: id,
      action: "UPDATE",
      before,
      after: result.rows[0],
      performedBy: req.user?.userId,
    });

    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ---- Customer Tier Engine workflow ----

// POST /customers/:id/tier/evaluate
// Deterministically recommend a tier from the configured rules + customer attributes.
customersRouter.post(
  "/:id/tier/evaluate",
  requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customer = await getCustomerOrThrow(req.params.id);
      const rules = await loadTierRules();

      const outcome = evaluateCustomerTier(
        {
          customer_type: customer.customer_type,
          expected_po_value: Number(customer.expected_po_value) || 0,
          upfront_payment_pct: Number(customer.upfront_payment_pct) || 0,
          payment_terms: customer.payment_terms,
        },
        rules
      );

      res.json({
        data: {
          customer_id: Number(customer.id),
          recommended_tier: outcome.recommended_tier,
          matched_rules: outcome.matched_rules,
          input: {
            customer_type: customer.customer_type,
            expected_po_value: Number(customer.expected_po_value),
            payment_terms: customer.payment_terms,
            upfront_payment_pct: Number(customer.upfront_payment_pct),
          },
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /customers/:id/tier/confirm
// Sales Rep / Admin accepts the engine recommendation -> resolved tier is set.
customersRouter.post(
  "/:id/tier/confirm",
  requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customer = await getCustomerOrThrow(req.params.id);
      const rules = await loadTierRules();
      const outcome = evaluateCustomerTier(
        {
          customer_type: customer.customer_type,
          expected_po_value: Number(customer.expected_po_value) || 0,
          upfront_payment_pct: Number(customer.upfront_payment_pct) || 0,
          payment_terms: customer.payment_terms,
        },
        rules
      );

      const tier = await query(
        `SELECT id FROM customer_tiers WHERE UPPER(name) = $1`,
        [outcome.recommended_tier]
      );
      if (tier.rows.length === 0) {
        throw new ConflictError(`Tier ${outcome.recommended_tier} not found`);
      }
      const tierId = Number(tier.rows[0].id);

      const inputSnapshot = {
        customer_type: customer.customer_type,
        expected_po_value: Number(customer.expected_po_value),
        payment_terms: customer.payment_terms,
        upfront_payment_pct: Number(customer.upfront_payment_pct),
      };

      await query(
        `UPDATE customers SET tier_id = $1, updated_at = NOW() WHERE id = $2`,
        [tierId, customer.id]
      );

      await query(
        `INSERT INTO customer_tier_evaluations
           (customer_id, status, recommended_tier, resolved_tier, input_snapshot, matched_rules, action_by, reason)
         VALUES ($1, 'CONFIRMED', $2, $2, $3::jsonb, $4::jsonb, $5, $6)`,
        [
          customer.id,
          outcome.recommended_tier,
          JSON.stringify(inputSnapshot),
          JSON.stringify(outcome.matched_rules),
          req.user?.userId ?? null,
          req.body?.reason ?? "Sales Representative accepted the recommended tier",
        ]
      );

      await writeAuditLog({
        entityType: "customer_tier",
        entityId: customer.id,
        action: "TIER_CONFIRMED",
        before: { tier: customer.tier_name },
        after: { tier: outcome.recommended_tier },
        performedBy: req.user?.userId,
        reason: "Recommended tier confirmed",
      });

      res.json({
        data: {
          customer_id: Number(customer.id),
          resolved_tier: outcome.recommended_tier,
          status: "CONFIRMED",
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /customers/:id/tier/override
// A non-recommended tier requires a manager-approval/override path + audit record.
customersRouter.post(
  "/:id/tier/override",
  requireRole(ROLES.ADMIN, ROLES.SALES_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        requested_tier: z.enum(TIERS),
        reason: z.string().min(1, "An override reason is required"),
      });
      const body = schema.parse(req.body);

      const customer = await getCustomerOrThrow(req.params.id);
      const tier = await query(
        `SELECT id FROM customer_tiers WHERE UPPER(name) = $1`,
        [body.requested_tier]
      );
      if (tier.rows.length === 0) {
        throw new ConflictError(`Tier ${body.requested_tier} not found`);
      }
      const tierId = Number(tier.rows[0].id);

      // The engine's recommendation is recorded (not silently overwritten) so
      // the override stays explainable against what the rules said.
      const rules = await loadTierRules();
      const outcome = evaluateCustomerTier(
        {
          customer_type: customer.customer_type,
          expected_po_value: Number(customer.expected_po_value) || 0,
          upfront_payment_pct: Number(customer.upfront_payment_pct) || 0,
          payment_terms: customer.payment_terms,
        },
        rules
      );

      const inputSnapshot = {
        customer_type: customer.customer_type,
        expected_po_value: Number(customer.expected_po_value),
        payment_terms: customer.payment_terms,
        upfront_payment_pct: Number(customer.upfront_payment_pct),
      };

      await query(
        `UPDATE customers SET tier_id = $1, updated_at = NOW() WHERE id = $2`,
        [tierId, customer.id]
      );

      await query(
        `INSERT INTO customer_tier_evaluations
           (customer_id, status, recommended_tier, resolved_tier, input_snapshot, matched_rules, action_by, reason)
         VALUES ($1, 'OVERRIDDEN', $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
        [
          customer.id,
          outcome.recommended_tier,
          body.requested_tier,
          JSON.stringify(inputSnapshot),
          JSON.stringify(outcome.matched_rules),
          req.user?.userId ?? null,
          body.reason,
        ]
      );

      await writeAuditLog({
        entityType: "customer_tier",
        entityId: customer.id,
        action: "TIER_OVERRIDE",
        before: { tier: customer.tier_name },
        after: { tier: body.requested_tier },
        performedBy: req.user?.userId,
        reason: body.reason,
      });

      const updated = await getCustomerOrThrow(String(customer.id));
      res.json({
        data: {
          customer_id: Number(customer.id),
          resolved_tier: body.requested_tier,
          status: "OVERRIDDEN",
          reason: body.reason,
          customer: updated,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /customers/:id/tier/evaluations
// History of evaluate / confirm / override actions for a customer (audit trail).
customersRouter.get(
  "/:id/tier/evaluations",
  requireRole(ROLES.ADMIN, ROLES.SALES_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await getCustomerOrThrow(req.params.id);
      const result = await query(
        `SELECT id, status, recommended_tier, resolved_tier, input_snapshot,
                matched_rules, action_by, action_at, reason
         FROM customer_tier_evaluations
         WHERE customer_id = $1
         ORDER BY action_at DESC`,
        [req.params.id]
      );
      res.json({ data: result.rows });
    } catch (err) {
      next(err);
    }
  }
);
