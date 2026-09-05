import { Router, Request, Response, NextFunction } from "express";
import { query } from "../../database/pool.js";
import { authenticate, requireRole, ROLES } from "../../middleware/auth.js";
import { NotFoundError, ValidationError } from "../../shared/errors.js";
import { z } from "zod";

export const productsRouter = Router();
productsRouter.use(authenticate);

const productSchema = z.object({
  sku: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  category_id: z.number().int().positive(),
  product_type: z.enum(["ONE_TIME", "RECURRING"]).default("ONE_TIME"),
  base_cost: z.number().nonnegative(),
  is_active: z.boolean().default(true),
});

const variantSchema = z.object({
  sku: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  attributes: z.record(z.unknown()).default({}),
});

const relationshipSchema = z.object({
  related_product_id: z.number().int().positive(),
  relationship_type: z.enum(["UPSELL", "CROSS_SELL"]),
});

function serializeProduct(product: any, userRole: number) {
  const { ...rest } = product;
  // Convert numeric strings to numbers
  rest.id = Number(rest.id);
  rest.category_id = Number(rest.category_id);
  rest.base_cost = Number(rest.base_cost);

  // If user is not Admin or Finance, strip base_cost
  if (userRole !== ROLES.ADMIN && userRole !== ROLES.FINANCE) {
    delete rest.base_cost;
  }
  return rest;
}

// GET /api/v1/products
productsRouter.get("/", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userRole = (req as any).user.roleId;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (req.query.category_id) {
      where.push(`p.category_id = $${paramIdx++}`);
      params.push(parseInt(req.query.category_id as string));
    }
    if (req.query.product_type) {
      where.push(`p.product_type = $${paramIdx++}`);
      params.push(req.query.product_type);
    }
    if (req.query.is_active !== undefined) {
      where.push(`p.is_active = $${paramIdx++}`);
      params.push(req.query.is_active === "true");
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const countResult = await query(`SELECT COUNT(*) FROM products p ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT p.id, p.sku, p.name, p.description, p.category_id, cat.name as category_name,
              p.product_type, p.base_cost, p.is_active, p.created_at, p.updated_at
       FROM products p
       LEFT JOIN categories cat ON p.category_id = cat.id
       ${whereClause}
       ORDER BY p.name ASC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    const data = result.rows.map((p) => serializeProduct(p, userRole));

    res.json({
      data,
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/products/:id
productsRouter.get("/:id", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userRole = (req as any).user.roleId;
    const { id } = req.params;

    const productResult = await query(
      `SELECT p.id, p.sku, p.name, p.description, p.category_id, cat.name as category_name,
              p.product_type, p.base_cost, p.is_active, p.created_at, p.updated_at
       FROM products p
       LEFT JOIN categories cat ON p.category_id = cat.id
       WHERE p.id = $1`,
      [id]
    );

    if (productResult.rows.length === 0) {
      throw new NotFoundError("Product", id);
    }

    const product = serializeProduct(productResult.rows[0], userRole);

    const variantsResult = await query(
      `SELECT id, sku, name, attributes, created_at, updated_at
       FROM product_variants
       WHERE product_id = $1
       ORDER BY name ASC`,
      [id]
    );

    const pricingResult = await query(
      `SELECT pli.id, pli.price_list_id, pl.name as price_list_name, pl.customer_tier_id,
              ct.name as tier_name, pl.currency_code, pli.unit_price
       FROM price_list_items pli
       JOIN price_lists pl ON pli.price_list_id = pl.id
       JOIN customer_tiers ct ON pl.customer_tier_id = ct.id
       WHERE pli.product_id = $1 AND pl.is_active = true
       ORDER BY pl.currency_code ASC, ct.name ASC`,
      [id]
    );

    res.json({
      data: {
        ...product,
        variants: variantsResult.rows.map((v) => ({ ...v, id: Number(v.id) })),
        pricing: pricingResult.rows.map((pr) => ({
          ...pr,
          id: Number(pr.id),
          price_list_id: Number(pr.price_list_id),
          customer_tier_id: Number(pr.customer_tier_id),
          unit_price: Number(pr.unit_price),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/products (Admin only)
productsRouter.post("/", requireRole(ROLES.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userRole = (req as any).user.roleId;
    const data = productSchema.parse(req.body);

    const result = await query(
      `INSERT INTO products (sku, name, description, category_id, product_type, base_cost, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [data.sku, data.name, data.description || null, data.category_id, data.product_type, data.base_cost, data.is_active]
    );

    res.status(201).json({ data: serializeProduct(result.rows[0], userRole) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/products/:id (Admin only)
productsRouter.patch("/:id", requireRole(ROLES.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userRole = (req as any).user.roleId;
    const { id } = req.params;
    const fields = productSchema.partial().parse(req.body);
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);

    if (entries.length === 0) {
      throw new ValidationError("No fields to update");
    }

    const setClauses = entries.map(([key], i) => `${key} = $${i + 1}`);
    const values = entries.map(([, v]) => v);

    const result = await query(
      `UPDATE products SET ${setClauses.join(", ")}, updated_at = NOW()
       WHERE id = $${entries.length + 1}
       RETURNING *`,
      [...values, id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Product", id);
    }

    res.json({ data: serializeProduct(result.rows[0], userRole) });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/products/:id/variants
productsRouter.get("/:id/variants", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT id, product_id, sku, name, attributes, created_at, updated_at
       FROM product_variants
       WHERE product_id = $1
       ORDER BY name ASC`,
      [id]
    );
    res.json({ data: result.rows.map((v) => ({ ...v, id: Number(v.id), product_id: Number(v.product_id) })) });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/products/:id/variants (Admin only)
productsRouter.post("/:id/variants", requireRole(ROLES.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const data = variantSchema.parse(req.body);

    const result = await query(
      `INSERT INTO product_variants (product_id, sku, name, attributes)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, data.sku, data.name, JSON.stringify(data.attributes)]
    );

    const row = result.rows[0];
    res.status(201).json({ data: { ...row, id: Number(row.id), product_id: Number(row.product_id) } });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/products/:id/relationships
productsRouter.get("/:id/relationships", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT pr.id, pr.product_id, pr.related_product_id, p.name as related_product_name,
              p.sku as related_product_sku, pr.relationship_type, pr.created_at
       FROM product_relationships pr
       JOIN products p ON pr.related_product_id = p.id
       WHERE pr.product_id = $1
       ORDER BY pr.relationship_type ASC, p.name ASC`,
      [id]
    );
    res.json({
      data: result.rows.map((r) => ({
        ...r,
        id: Number(r.id),
        product_id: Number(r.product_id),
        related_product_id: Number(r.related_product_id),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/products/:id/relationships (Admin only)
productsRouter.post("/:id/relationships", requireRole(ROLES.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const data = relationshipSchema.parse(req.body);

    if (Number(id) === data.related_product_id) {
      throw new ValidationError("Product cannot be related to itself");
    }

    const result = await query(
      `INSERT INTO product_relationships (product_id, related_product_id, relationship_type)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, data.related_product_id, data.relationship_type]
    );

    const row = result.rows[0];
    res.status(201).json({
      data: {
        ...row,
        id: Number(row.id),
        product_id: Number(row.product_id),
        related_product_id: Number(row.related_product_id),
      },
    });
  } catch (err) {
    next(err);
  }
});
