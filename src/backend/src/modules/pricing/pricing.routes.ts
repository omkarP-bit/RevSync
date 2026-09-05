import { Router, Request, Response, NextFunction } from "express";
import { query } from "../../database/pool.js";
import { authenticate, requireRole, ROLES } from "../../middleware/auth.js";
import { NotFoundError } from "../../shared/errors.js";
import { z } from "zod";

export const pricingRouter = Router();
pricingRouter.use(authenticate);

const priceListSchema = z.object({
  name: z.string().min(1).max(255),
  customer_tier_id: z.number().int().positive(),
  currency_code: z.string().length(3),
  is_active: z.boolean().default(true),
});

const priceListItemSchema = z.object({
  product_id: z.number().int().positive(),
  unit_price: z.number().nonnegative(),
});

// GET /api/v1/pricelists
pricingRouter.get("/", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER, ROLES.FINANCE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (req.query.tier_id) {
      where.push(`pl.customer_tier_id = $${paramIdx++}`);
      params.push(parseInt(req.query.tier_id as string));
    }
    if (req.query.currency_code) {
      where.push(`pl.currency_code = $${paramIdx++}`);
      params.push(req.query.currency_code);
    }
    if (req.query.is_active !== undefined) {
      where.push(`pl.is_active = $${paramIdx++}`);
      params.push(req.query.is_active === "true");
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const countResult = await query(`SELECT COUNT(*) FROM price_lists pl ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT pl.id, pl.name, pl.customer_tier_id, ct.name as tier_name,
              pl.currency_code, pl.is_active, pl.created_at, pl.updated_at
       FROM price_lists pl
       JOIN customer_tiers ct ON pl.customer_tier_id = ct.id
       ${whereClause}
       ORDER BY pl.is_active DESC, pl.name ASC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    res.json({
      data: result.rows.map((row) => ({
        ...row,
        id: Number(row.id),
        customer_tier_id: Number(row.customer_tier_id),
      })),
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/pricelists/:id
pricingRouter.get("/:id", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER, ROLES.FINANCE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const listResult = await query(
      `SELECT pl.id, pl.name, pl.customer_tier_id, ct.name as tier_name,
              pl.currency_code, pl.is_active, pl.created_at, pl.updated_at
       FROM price_lists pl
       JOIN customer_tiers ct ON pl.customer_tier_id = ct.id
       WHERE pl.id = $1`,
      [id]
    );

    if (listResult.rows.length === 0) {
      throw new NotFoundError("PriceList", id);
    }

    const priceList = listResult.rows[0];

    const itemsResult = await query(
      `SELECT pli.id, pli.price_list_id, pli.product_id, p.name as product_name,
              p.sku as product_sku, pli.unit_price, pli.created_at, pli.updated_at
       FROM price_list_items pli
       JOIN products p ON pli.product_id = p.id
       WHERE pli.price_list_id = $1
       ORDER BY p.name ASC`,
      [id]
    );

    res.json({
      data: {
        ...priceList,
        id: Number(priceList.id),
        customer_tier_id: Number(priceList.customer_tier_id),
        items: itemsResult.rows.map((item) => ({
          ...item,
          id: Number(item.id),
          price_list_id: Number(item.price_list_id),
          product_id: Number(item.product_id),
          unit_price: Number(item.unit_price),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/pricelists (Admin only)
pricingRouter.post("/", requireRole(ROLES.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = priceListSchema.parse(req.body);

    const result = await query(
      `INSERT INTO price_lists (name, customer_tier_id, currency_code, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.name, data.customer_tier_id, data.currency_code.toUpperCase(), data.is_active]
    );

    const row = result.rows[0];
    res.status(201).json({
      data: {
        ...row,
        id: Number(row.id),
        customer_tier_id: Number(row.customer_tier_id),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/pricelists/:id/items (Admin only)
pricingRouter.post("/:id/items", requireRole(ROLES.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const data = priceListItemSchema.parse(req.body);

    // Verify price list exists
    const listCheck = await query(`SELECT id FROM price_lists WHERE id = $1`, [id]);
    if (listCheck.rows.length === 0) {
      throw new NotFoundError("PriceList", id);
    }

    const result = await query(
      `INSERT INTO price_list_items (price_list_id, product_id, unit_price)
       VALUES ($1, $2, $3)
       ON CONFLICT (price_list_id, product_id) DO UPDATE SET
         unit_price = EXCLUDED.unit_price,
         updated_at = NOW()
       RETURNING *`,
      [id, data.product_id, data.unit_price]
    );

    const row = result.rows[0];
    res.status(201).json({
      data: {
        ...row,
        id: Number(row.id),
        price_list_id: Number(row.price_list_id),
        product_id: Number(row.product_id),
        unit_price: Number(row.unit_price),
      },
    });
  } catch (err) {
    next(err);
  }
});
