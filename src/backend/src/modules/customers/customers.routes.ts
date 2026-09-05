import { Router, Request, Response, NextFunction } from "express";
import { query } from "../../database/pool.js";
import { authenticate, requireRole, ROLES } from "../../middleware/auth.js";
import { NotFoundError, ValidationError } from "../../shared/errors.js";
import { z } from "zod";

export const customersRouter = Router();
customersRouter.use(authenticate);

const customerSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  company: z.string().max(255).optional(),
  phone: z.string().max(50).optional(),
  tier_id: z.number().int().positive(),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).default("ACTIVE"),
  currency_code: z.string().length(3).default("USD"),
});

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
      `SELECT c.id, c.name, c.email, c.company, c.phone, c.status, c.currency_code,
              c.tier_id, ct.name as tier_name, c.created_at, c.updated_at
       FROM customers c
       LEFT JOIN customer_tiers ct ON c.tier_id = ct.id
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
    const { id } = req.params;
    const result = await query(
      `SELECT c.id, c.name, c.email, c.company, c.phone, c.status, c.currency_code,
              c.tier_id, ct.name as tier_name, c.created_at, c.updated_at
       FROM customers c
       LEFT JOIN customer_tiers ct ON c.tier_id = ct.id
       WHERE c.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Customer", id);
    }

    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

customersRouter.post("/", requireRole(ROLES.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = customerSchema.parse(req.body);
    const result = await query(
      `INSERT INTO customers (name, email, company, phone, tier_id, status, currency_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [data.name, data.email.toLowerCase(), data.company, data.phone, data.tier_id, data.status, data.currency_code]
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

    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});
