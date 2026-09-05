import { Router, Request, Response, NextFunction } from "express";
import { query } from "../../database/pool.js";
import { authenticate, requireRole, ROLES } from "../../middleware/auth.js";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors.js";
import { writeAuditLog } from "../../shared/audit.js";
import { z } from "zod";

export const discountsRouter = Router();
discountsRouter.use(authenticate);

const discountRuleSchema = z.object({
  customer_tier_id: z.number().int().positive(),
  category_id: z.number().int().positive(),
  max_discount_pct: z.number().min(0).max(100),
  is_active: z.boolean().default(true),
});

// GET /api/v1/discounts/rules
discountsRouter.get("/rules", requireRole(ROLES.ADMIN, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (req.query.tier_id) {
      where.push(`dr.customer_tier_id = $${paramIdx++}`);
      params.push(parseInt(req.query.tier_id as string));
    }
    if (req.query.category_id) {
      where.push(`dr.category_id = $${paramIdx++}`);
      params.push(parseInt(req.query.category_id as string));
    }
    if (req.query.is_active !== undefined) {
      where.push(`dr.is_active = $${paramIdx++}`);
      params.push(req.query.is_active === "true");
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const countResult = await query(`SELECT COUNT(*) FROM discount_rules dr ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT dr.id, dr.customer_tier_id, ct.name as tier_name, dr.category_id,
              cat.name as category_name, dr.max_discount_pct, dr.is_active,
              dr.created_at, dr.updated_at
       FROM discount_rules dr
       JOIN customer_tiers ct ON dr.customer_tier_id = ct.id
       JOIN categories cat ON dr.category_id = cat.id
       ${whereClause}
       ORDER BY dr.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    res.json({
      data: result.rows.map((row) => ({
        ...row,
        id: Number(row.id),
        customer_tier_id: Number(row.customer_tier_id),
        category_id: Number(row.category_id),
        max_discount_pct: Number(row.max_discount_pct),
      })),
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/discounts/rules (Admin only)
discountsRouter.post("/rules", requireRole(ROLES.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = discountRuleSchema.parse(req.body);
    const userId = (req as any).user.userId;

    const tierCheck = await query(`SELECT id FROM customer_tiers WHERE id = $1`, [data.customer_tier_id]);
    if (tierCheck.rows.length === 0) {
      throw new NotFoundError("Customer tier", data.customer_tier_id);
    }
    const categoryCheck = await query(`SELECT id FROM categories WHERE id = $1`, [data.category_id]);
    if (categoryCheck.rows.length === 0) {
      throw new NotFoundError("Category", data.category_id);
    }

    const conflict = await query(
      `SELECT id FROM discount_rules
       WHERE customer_tier_id = $1 AND category_id = $2 AND is_active = true`,
      [data.customer_tier_id, data.category_id]
    );
    if (conflict.rows.length > 0) {
      throw new ConflictError("An active discount rule already exists for this customer tier and category");
    }

    const result = await query(
      `INSERT INTO discount_rules (customer_tier_id, category_id, max_discount_pct, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.customer_tier_id, data.category_id, data.max_discount_pct, data.is_active]
    );

    const row = result.rows[0];
    await writeAuditLog({
      entityType: "discount_rules",
      entityId: row.id,
      action: "RULE_CREATED",
      before: null,
      after: {
        customer_tier_id: Number(row.customer_tier_id),
        category_id: Number(row.category_id),
        max_discount_pct: Number(row.max_discount_pct),
        is_active: row.is_active,
      },
      performedBy: userId,
      reason: "Discount rule configured",
    });

    res.status(201).json({
      data: {
        ...row,
        id: Number(row.id),
        customer_tier_id: Number(row.customer_tier_id),
        category_id: Number(row.category_id),
        max_discount_pct: Number(row.max_discount_pct),
      },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/discounts/rules/:id (Admin only)
discountsRouter.patch("/rules/:id", requireRole(ROLES.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.userId;
    const fields = discountRuleSchema.partial().parse(req.body);
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);

    if (entries.length === 0) {
      throw new ValidationError("No fields to update");
    }

    const before = await query(`SELECT * FROM discount_rules WHERE id = $1`, [id]);
    if (before.rows.length === 0) {
      throw new NotFoundError("Discount rule", id);
    }

    const setClauses = entries.map(([key], i) => `${key} = $${i + 1}`);
    const values = entries.map(([, v]) => v);

    const result = await query(
      `UPDATE discount_rules SET ${setClauses.join(", ")}, updated_at = NOW()
       WHERE id = $${entries.length + 1}
       RETURNING *`,
      [...values, id]
    );

    const row = result.rows[0];
    await writeAuditLog({
      entityType: "discount_rules",
      entityId: row.id,
      action: "RULE_UPDATED",
      before: before.rows[0],
      after: row,
      performedBy: userId,
      reason: "Discount rule updated",
    });

    res.json({
      data: {
        ...row,
        id: Number(row.id),
        customer_tier_id: Number(row.customer_tier_id),
        category_id: Number(row.category_id),
        max_discount_pct: Number(row.max_discount_pct),
      },
    });
  } catch (err) {
    next(err);
  }
});