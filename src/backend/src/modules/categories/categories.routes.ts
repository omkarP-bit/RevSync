import { Router, Request, Response, NextFunction } from "express";
import { query } from "../../database/pool.js";
import { authenticate, requireRole, ROLES } from "../../middleware/auth.js";
import { NotFoundError, ValidationError } from "../../shared/errors.js";
import { z } from "zod";

export const categoriesRouter = Router();
categoriesRouter.use(authenticate);

const categorySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(500).optional(),
  parent_id: z.number().int().positive().optional(),
});

categoriesRouter.get("/", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER, ROLES.FINANCE, ROLES.WAREHOUSE_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const countResult = await query("SELECT COUNT(*) FROM categories");
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT id, name, description, parent_id, created_at, updated_at
       FROM categories
       ORDER BY name ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({
      data: result.rows,
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

categoriesRouter.get("/:id", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER, ROLES.FINANCE, ROLES.WAREHOUSE_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await query("SELECT * FROM categories WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) throw new NotFoundError("Category", req.params.id);
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

categoriesRouter.post("/", requireRole(ROLES.ADMIN, ROLES.SALES_MANAGER, ROLES.WAREHOUSE_MANAGER, ROLES.FINANCE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = categorySchema.parse(req.body);
    const result = await query(
      "INSERT INTO categories (name, description, parent_id) VALUES ($1, $2, $3) RETURNING *",
      [data.name, data.description, data.parent_id]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

categoriesRouter.patch("/:id", requireRole(ROLES.ADMIN, ROLES.SALES_MANAGER, ROLES.WAREHOUSE_MANAGER, ROLES.FINANCE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fields = categorySchema.partial().parse(req.body);
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length === 0) throw new ValidationError("No fields to update");

    const setClauses = entries.map(([key], i) => `${key} = $${i + 1}`);
    const values = entries.map(([, v]) => v);

    const result = await query(
      `UPDATE categories SET ${setClauses.join(", ")}, updated_at = NOW()
       WHERE id = $${entries.length + 1} RETURNING *`,
      [...values, req.params.id]
    );

    if (result.rows.length === 0) throw new NotFoundError("Category", req.params.id);
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});
