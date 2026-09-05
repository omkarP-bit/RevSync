import { Router, Request, Response, NextFunction } from "express";
import { query } from "../../database/pool.js";
import { authenticate, requireRole, ROLES } from "../../middleware/auth.js";
import { NotFoundError, ValidationError, ConflictError, ForbiddenError } from "../../shared/errors.js";
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
  company: z.string().max(255).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  tier_id: z.number().int().positive().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).default("ACTIVE"),
  currency_code: z.string().length(3).default("USD"),
  customer_type: z.enum(CUSTOMER_TYPES).default("BUSINESS"),
  expected_po_value: z.number().min(0).default(0),
  payment_terms: z.enum(PAYMENT_TERMS).default("NET_30"),
  upfront_payment_pct: z.number().min(0).max(100).default(0),
  credit_limit: z.number().min(0).default(0),
  billing_address: z.string().optional().nullable(),
  shipping_address: z.string().optional().nullable(),
});

const CUSTOMER_SELECT = `
  SELECT c.id, c.name, c.email, c.company, c.phone, c.status, c.currency_code,
         c.tier_id, ct_eff.name as tier_name,
         c.calculated_tier_id, ct_calc.name as calculated_tier_name,
         c.tier_override_id, ct_over.name as override_tier_name,
         c.tier_override_by, u_over.first_name || ' ' || u_over.last_name as override_by_name,
         c.tier_override_at, c.tier_override_reason,
         c.customer_type, c.expected_po_value, c.payment_terms, c.upfront_payment_pct,
         c.credit_limit, c.billing_address, c.shipping_address,
         c.created_at, c.updated_at
  FROM customers c
  LEFT JOIN customer_tiers ct_eff ON c.tier_id = ct_eff.id
  LEFT JOIN customer_tiers ct_calc ON c.calculated_tier_id = ct_calc.id
  LEFT JOIN customer_tiers ct_over ON c.tier_override_id = ct_over.id
  LEFT JOIN users u_over ON c.tier_override_by = u_over.id
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

// GET /api/v1/customers/tiers — list active customer tiers
customersRouter.get("/tiers", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await query(`SELECT id, name, description, discount_ceiling_pct FROM customer_tiers ORDER BY id ASC`);
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/customers/evaluate-preview — live calculated tier preview for UI
customersRouter.post("/evaluate-preview", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const previewSchema = z.object({
      customer_type: z.enum(CUSTOMER_TYPES).default("BUSINESS"),
      expected_po_value: z.number().min(0).default(0),
      upfront_payment_pct: z.number().min(0).max(100).default(0),
      payment_terms: z.enum(PAYMENT_TERMS).default("NET_30"),
    });
    const body = previewSchema.parse(req.body);
    const rules = await loadTierRules();
    const outcome = evaluateCustomerTier(body, rules);
    res.json({
      data: {
        recommended_tier: outcome.recommended_tier,
        matched_rules: outcome.matched_rules,
        input: body,
      },
    });
  } catch (err) {
    next(err);
  }
});

customersRouter.get("/", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (req.query.search) {
      where.push(`(c.name ILIKE $${paramIdx} OR c.company ILIKE $${paramIdx} OR c.email ILIKE $${paramIdx})`);
      params.push(`%${req.query.search}%`);
      paramIdx++;
    }
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

// GET /api/v1/customers/:id/wallet — credit wallet & transaction history
customersRouter.get("/:id/wallet", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER, ROLES.FINANCE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const custResult = await query(`SELECT id, currency_code FROM customers WHERE id = $1`, [id]);
    if (custResult.rows.length === 0) {
      throw new NotFoundError("Customer", id);
    }
    const customerId = parseInt(id);
    const currency = custResult.rows[0].currency_code || "USD";

    const walletRes = await query(
      `SELECT id, customer_id, balance, currency, created_at, updated_at
       FROM customer_credit_wallets WHERE customer_id = $1`,
      [customerId]
    );

    let wallet = walletRes.rows[0];
    if (!wallet) {
      const insert = await query(
        `INSERT INTO customer_credit_wallets (customer_id, balance, currency) VALUES ($1, 0, $2) RETURNING *`,
        [customerId, currency]
      );
      wallet = insert.rows[0];
    }

    const txRes = await query(
      `SELECT id, type, amount, reference_type, reference_id, description, created_at
       FROM credit_transactions
       WHERE wallet_id = $1
       ORDER BY created_at DESC`,
      [wallet.id]
    );

    res.json({
      data: {
        id: Number(wallet.id),
        customer_id: Number(wallet.customer_id),
        balance: Number(wallet.balance),
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


// GET /api/v1/customers/:id/quotations
customersRouter.get("/:id/quotations", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER, ROLES.FINANCE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    const custResult = await query(`SELECT id, name, currency_code, tier_id FROM customers WHERE id = $1`, [id]);
    if (custResult.rows.length === 0) {
      throw new NotFoundError("Customer", id);
    }
    const customer = custResult.rows[0];

    const countResult = await query(`SELECT COUNT(*) FROM quotations WHERE customer_id = $1`, [id]);
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
       WHERE q.customer_id = $1
       ORDER BY q.created_at DESC
       LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    );

    res.json({
      customer,
      data: result.rows.map((row) => ({
        ...row,
        id: Number(row.id),
        customer_id: Number(row.customer_id),
        sales_rep_id: Number(row.sales_rep_id),
        subtotal: Number(row.subtotal),
        discount_total: Number(row.discount_total),
        tax_total: Number(row.tax_total),
        grand_total: Number(row.grand_total),
        margin_amount: Number(row.margin_amount),
        margin_pct: Number(row.margin_pct),
        total_overage: Number(row.total_overage),
      })),
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

customersRouter.post("/", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const isSalesRep = req.user?.roleId === ROLES.SALES_REP;

    if (isSalesRep && req.body.credit_limit !== undefined && req.body.credit_limit > 0) {
      throw new ForbiddenError("Sales representatives are not authorized to set or modify credit limits.");
    }

    const data = customerSchema.parse(req.body);

    const rules = await loadTierRules();
    const outcome = evaluateCustomerTier(
      {
        customer_type: data.customer_type,
        expected_po_value: data.expected_po_value,
        upfront_payment_pct: data.upfront_payment_pct,
        payment_terms: data.payment_terms,
      },
      rules
    );

    const calcTierRes = await query(`SELECT id FROM customer_tiers WHERE UPPER(name) = $1`, [outcome.recommended_tier]);
    const calculatedTierId = calcTierRes.rows[0] ? Number(calcTierRes.rows[0].id) : (data.tier_id || 1);

    let effectiveTierId = calculatedTierId;
    let overrideTierId: number | null = null;
    let overrideBy: number | null = null;
    let overrideAt: Date | null = null;
    let overrideReason: string | null = null;

    if (!isSalesRep && data.tier_id && data.tier_id !== calculatedTierId) {
      effectiveTierId = data.tier_id;
      overrideTierId = data.tier_id;
      overrideBy = req.user?.userId ?? null;
      overrideAt = new Date();
      overrideReason = req.body.tier_override_reason || "Manager override at customer creation";
    }

    const insertRes = await query(
      `INSERT INTO customers (name, email, company, phone, tier_id, calculated_tier_id,
                              tier_override_id, tier_override_by, tier_override_at, tier_override_reason,
                              status, currency_code, customer_type, expected_po_value, payment_terms,
                              upfront_payment_pct, credit_limit, billing_address, shipping_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING id`,
      [
        data.name,
        data.email.toLowerCase(),
        data.company ?? null,
        data.phone ?? null,
        effectiveTierId,
        calculatedTierId,
        overrideTierId,
        overrideBy,
        overrideAt,
        overrideReason,
        data.status,
        data.currency_code,
        data.customer_type,
        data.expected_po_value,
        data.payment_terms,
        data.upfront_payment_pct,
        isSalesRep ? 0 : data.credit_limit,
        data.billing_address ?? null,
        data.shipping_address ?? null,
      ]
    );

    const createdId = insertRes.rows[0].id;

    const inputSnapshot = {
      customer_type: data.customer_type,
      expected_po_value: data.expected_po_value,
      payment_terms: data.payment_terms,
      upfront_payment_pct: data.upfront_payment_pct,
    };

    await query(
      `INSERT INTO customer_tier_evaluations
         (customer_id, status, recommended_tier, resolved_tier, input_snapshot, matched_rules, action_by, reason)
       VALUES ($1, $2, $3, (SELECT name FROM customer_tiers WHERE id = $4), $5::jsonb, $6::jsonb, $7, $8)`,
      [
        createdId,
        overrideTierId ? "OVERRIDDEN" : "CONFIRMED",
        outcome.recommended_tier,
        effectiveTierId,
        JSON.stringify(inputSnapshot),
        JSON.stringify(outcome.matched_rules),
        req.user?.userId ?? null,
        overrideReason || "Automatic server-side tier evaluation at creation",
      ]
    );

    const fullCustomer = await getCustomerOrThrow(String(createdId));

    await writeAuditLog({
      entityType: "customer",
      entityId: String(createdId),
      action: "CREATE",
      after: fullCustomer,
      performedBy: req.user?.userId,
    });

    res.status(201).json({ data: fullCustomer });
  } catch (err: any) {
    if (err.code === "23505" && err.constraint?.includes("email")) {
      return next(new ConflictError(`A customer with email ${req.body?.email} already exists.`));
    }
    next(err);
  }
});

customersRouter.patch("/:id", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const isSalesRep = req.user?.roleId === ROLES.SALES_REP;
    const fields = customerSchema.partial().parse(req.body);

    if (isSalesRep) {
      if (fields.credit_limit !== undefined) {
        throw new ForbiddenError("Sales representatives are not authorized to set or modify credit limits.");
      }
      if (fields.tier_id !== undefined) {
        throw new ForbiddenError("Sales Representatives are not authorized to modify customer tier");
      }
    }

    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);

    if (entries.length === 0) {
      throw new ValidationError("No fields to update");
    }

    const before = await getCustomerOrThrow(id);

    const hasCommercialChange =
      fields.customer_type !== undefined ||
      fields.upfront_payment_pct !== undefined ||
      fields.expected_po_value !== undefined ||
      fields.payment_terms !== undefined;

    let setClauses = entries.map(([key], i) => `${key} = $${i + 1}`);
    let values: unknown[] = entries.map(([, v]) => v);

    if (hasCommercialChange) {
      const mergedInput = {
        customer_type: fields.customer_type ?? before.customer_type,
        expected_po_value: fields.expected_po_value ?? (Number(before.expected_po_value) || 0),
        upfront_payment_pct: fields.upfront_payment_pct ?? (Number(before.upfront_payment_pct) || 0),
        payment_terms: fields.payment_terms ?? before.payment_terms,
      };

      const rules = await loadTierRules();
      const outcome = evaluateCustomerTier(mergedInput, rules);
      const calcRes = await query(`SELECT id FROM customer_tiers WHERE UPPER(name) = $1`, [outcome.recommended_tier]);
      const newCalculatedTierId = calcRes.rows[0] ? Number(calcRes.rows[0].id) : before.calculated_tier_id;

      setClauses.push(`calculated_tier_id = $${values.length + 1}`);
      values.push(newCalculatedTierId);

      if (!before.tier_override_id) {
        setClauses.push(`tier_id = $${values.length + 1}`);
        values.push(newCalculatedTierId);
      }
    }

    const result = await query(
      `UPDATE customers SET ${setClauses.join(", ")}, updated_at = NOW()
       WHERE id = $${values.length + 1}
       RETURNING id`,
      [...values, id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Customer", id);
    }

    const updated = await getCustomerOrThrow(id);

    await writeAuditLog({
      entityType: "customer",
      entityId: id,
      action: "UPDATE",
      before,
      after: updated,
      performedBy: req.user?.userId,
    });

    res.json({ data: updated });
  } catch (err: any) {
    if (err.code === "23505" && err.constraint?.includes("email")) {
      return next(new ConflictError(`A customer with email ${req.body?.email} already exists.`));
    }
    next(err);
  }
});

// ---- Customer Tier Engine workflow ----

// POST /customers/:id/tier/evaluate
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
        `UPDATE customers SET tier_id = $1, calculated_tier_id = $1, updated_at = NOW() WHERE id = $2`,
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
customersRouter.post(
  "/:id/tier/override",
  requireRole(ROLES.ADMIN, ROLES.SALES_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        requested_tier: z.enum(TIERS).optional(),
        override_tier_id: z.number().int().positive().optional(),
        reason: z.string().min(1, "An override reason is required"),
      });
      const body = schema.parse(req.body);

      const customer = await getCustomerOrThrow(req.params.id);
      let overrideTierId: number;
      let requestedTierName: string;

      if (body.override_tier_id) {
        const tierRes = await query(`SELECT id, name FROM customer_tiers WHERE id = $1`, [body.override_tier_id]);
        if (tierRes.rows.length === 0) {
          throw new ConflictError(`Tier ID ${body.override_tier_id} not found`);
        }
        overrideTierId = Number(tierRes.rows[0].id);
        requestedTierName = tierRes.rows[0].name;
      } else if (body.requested_tier) {
        const tierRes = await query(`SELECT id, name FROM customer_tiers WHERE UPPER(name) = $1`, [body.requested_tier]);
        if (tierRes.rows.length === 0) {
          throw new ConflictError(`Tier ${body.requested_tier} not found`);
        }
        overrideTierId = Number(tierRes.rows[0].id);
        requestedTierName = body.requested_tier;
      } else {
        throw new ValidationError("Either requested_tier or override_tier_id is required");
      }

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
        `UPDATE customers
         SET tier_id = $1,
             tier_override_id = $1,
             tier_override_by = $2,
             tier_override_at = NOW(),
             tier_override_reason = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [overrideTierId, req.user?.userId ?? null, body.reason, customer.id]
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
        after: { tier: requestedTierName, reason: body.reason },
        performedBy: req.user?.userId,
        reason: body.reason,
      });

      const updated = await getCustomerOrThrow(String(customer.id));
      res.json({
        data: {
          customer_id: Number(customer.id),
          resolved_tier: requestedTierName,
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

// POST /customers/:id/tier/clear-override
customersRouter.post(
  "/:id/tier/clear-override",
  requireRole(ROLES.ADMIN, ROLES.SALES_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customer = await getCustomerOrThrow(req.params.id);
      if (!customer.tier_override_id) {
        throw new ValidationError("Customer does not have an active manager tier override");
      }

      const calculatedTierId = customer.calculated_tier_id || customer.tier_id;

      await query(
        `UPDATE customers
         SET tier_id = calculated_tier_id,
             tier_override_id = NULL,
             tier_override_by = NULL,
             tier_override_at = NULL,
             tier_override_reason = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [customer.id]
      );

      await query(
        `INSERT INTO customer_tier_evaluations
           (customer_id, status, recommended_tier, resolved_tier, input_snapshot, matched_rules, action_by, reason)
         VALUES ($1, 'CONFIRMED', $2, $2, '{}'::jsonb, '[]'::jsonb, $3, $4)`,
        [
          customer.id,
          customer.calculated_tier_name || customer.tier_name,
          req.user?.userId ?? null,
          req.body?.reason || "Manager cleared tier override — reverted to calculated tier",
        ]
      );

      await writeAuditLog({
        entityType: "customer_tier",
        entityId: customer.id,
        action: "TIER_OVERRIDE_CLEARED",
        before: { override_tier: customer.override_tier_name },
        after: { effective_tier: customer.calculated_tier_name },
        performedBy: req.user?.userId,
        reason: "Override cleared",
      });

      const updated = await getCustomerOrThrow(String(customer.id));
      res.json({
        data: {
          customer_id: Number(customer.id),
          resolved_tier: updated.tier_name,
          status: "CONFIRMED",
          customer: updated,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /customers/:id/tier/evaluations
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
