import { Router, Request, Response, NextFunction } from "express";
import { query, withTransaction } from "../../database/pool.js";
import { authenticate, requireRole, ROLES } from "../../middleware/auth.js";
import { NotFoundError, ValidationError } from "../../shared/errors.js";
import { calculateQuotation } from "../../engines/quotation-engine.js";
import { resolveUnitPrice } from "../../engines/pricing-engine.js";
import { z } from "zod";

export const quotationsRouter = Router();
quotationsRouter.use(authenticate);

const createQuotationSchema = z.object({
  customer_id: z.number().int().positive(),
  tax_rate_pct: z.number().nonnegative().default(10.0),
  notes: z.string().optional(),
});

const patchQuotationSchema = z.object({
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "NEGOTIATION", "CONFIRMED", "CANCELLED"]).optional(),
  tax_rate_pct: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

const addLineSchema = z.object({
  product_id: z.number().int().positive(),
  product_variant_id: z.number().int().positive().nullable().optional(),
  description: z.string().optional(),
  quantity: z.number().int().positive().default(1),
  applied_discount_pct: z.number().min(0).max(100).default(0),
});

const patchLineSchema = z.object({
  quantity: z.number().int().positive().optional(),
  applied_discount_pct: z.number().min(0).max(100).optional(),
  description: z.string().optional(),
});

// Helper function to recalculate & persist a quotation inside a transaction or query
async function recalculateAndPersistQuotation(quotationId: number | string): Promise<any> {
  const isNumeric = typeof quotationId === "number" || /^\d+$/.test(String(quotationId));
  const quoteResult = await query(
    `SELECT q.id, q.customer_id, q.currency_code, q.tax_rate_pct, c.tier_id as customer_tier_id
     FROM quotations q
     JOIN customers c ON q.customer_id = c.id
     WHERE ${isNumeric ? "q.id = $1" : "q.public_id::text = $1"}`,
    [quotationId]
  );

  if (quoteResult.rows.length === 0) {
    throw new NotFoundError("Quotation", quotationId);
  }

  const quote = quoteResult.rows[0];

  const linesResult = await query(
    `SELECT id, product_id, product_variant_id, description, quantity,
            unit_price, unit_cost, applied_discount_pct
     FROM quotation_lines
     WHERE quotation_id = $1
     ORDER BY id ASC`,
    [quote.id]
  );

  const inputLines = linesResult.rows.map((row) => ({
    id: Number(row.id),
    product_id: Number(row.product_id),
    product_variant_id: row.product_variant_id ? Number(row.product_variant_id) : null,
    description: row.description,
    quantity: Number(row.quantity),
    unit_price: Number(row.unit_price),
    unit_cost: Number(row.unit_cost),
    applied_discount_pct: Number(row.applied_discount_pct),
  }));

  const calc = calculateQuotation(inputLines, Number(quote.tax_rate_pct));

  // Update lines in DB
  for (const line of calc.lines) {
    if (line.id) {
      await query(
        `UPDATE quotation_lines SET
           quantity = $1, unit_price = $2, unit_cost = $3,
           applied_discount_pct = $4, discount_amount = $5,
           line_subtotal = $6, line_total = $7, line_cost = $8,
           line_margin = $9, updated_at = NOW()
         WHERE id = $10`,
        [
          line.quantity,
          line.unit_price,
          line.unit_cost,
          line.applied_discount_pct,
          line.discount_amount,
          line.line_subtotal,
          line.line_total,
          line.line_cost,
          line.line_margin,
          line.id,
        ]
      );
    }
  }

  // Update header in DB
  const updateHeaderResult = await query(
    `UPDATE quotations SET
       subtotal = $1, discount_total = $2, tax_total = $3, grand_total = $4,
       total_cost = $5, margin_amount = $6, margin_pct = $7,
       total_overage = $8, risk_level = $9, updated_at = NOW()
     WHERE id = $10
     RETURNING *`,
    [
      calc.subtotal,
      calc.discount_total,
      calc.tax_total,
      calc.grand_total,
      calc.total_cost,
      calc.margin_amount,
      calc.margin_pct,
      calc.total_overage,
      calc.risk_level,
      quote.id,
    ]
  );

  return updateHeaderResult.rows[0];
}

// GET /api/v1/quotations
quotationsRouter.get("/", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER, ROLES.FINANCE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (req.query.status) {
      where.push(`q.status = $${paramIdx++}`);
      params.push(req.query.status);
    }
    if (req.query.customer_id) {
      where.push(`q.customer_id = $${paramIdx++}`);
      params.push(parseInt(req.query.customer_id as string));
    }
    if (req.query.sales_rep_id) {
      where.push(`q.sales_rep_id = $${paramIdx++}`);
      params.push(parseInt(req.query.sales_rep_id as string));
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const countResult = await query(`SELECT COUNT(*) FROM quotations q ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT q.id, q.quotation_number, q.public_id, q.customer_id, c.name as customer_name,
              q.sales_rep_id, u.first_name || ' ' || u.last_name as sales_rep_name,
              q.currency_code, q.status, q.subtotal, q.discount_total, q.tax_rate_pct,
              q.tax_total, q.grand_total, q.margin_amount, q.margin_pct, q.risk_level,
              q.created_at, q.updated_at
       FROM quotations q
       JOIN customers c ON q.customer_id = c.id
       JOIN users u ON q.sales_rep_id = u.id
       ${whereClause}
       ORDER BY q.status ASC, q.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    res.json({
      data: result.rows.map((row) => ({
        ...row,
        id: Number(row.id),
        customer_id: Number(row.customer_id),
        sales_rep_id: Number(row.sales_rep_id),
        subtotal: Number(row.subtotal),
        discount_total: Number(row.discount_total),
        tax_rate_pct: Number(row.tax_rate_pct),
        tax_total: Number(row.tax_total),
        grand_total: Number(row.grand_total),
        margin_amount: Number(row.margin_amount),
        margin_pct: Number(row.margin_pct),
      })),
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/quotations/:id
quotationsRouter.get("/:id", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER, ROLES.FINANCE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const isNumeric = /^\d+$/.test(id);

    const quoteResult = await query(
      `SELECT q.id, q.quotation_number, q.public_id, q.customer_id, c.name as customer_name,
              c.tier_id as customer_tier_id, ct.name as tier_name,
              q.sales_rep_id, u.first_name || ' ' || u.last_name as sales_rep_name,
              q.currency_code, q.status, q.subtotal, q.discount_total, q.tax_rate_pct,
              q.tax_total, q.grand_total, q.total_cost, q.margin_amount, q.margin_pct,
              q.total_overage, q.risk_level, q.notes, q.created_at, q.updated_at
       FROM quotations q
       JOIN customers c ON q.customer_id = c.id
       JOIN customer_tiers ct ON c.tier_id = ct.id
       JOIN users u ON q.sales_rep_id = u.id
       WHERE ${isNumeric ? "q.id = $1" : "q.public_id::text = $1"}`,
      [id]
    );

    if (quoteResult.rows.length === 0) {
      throw new NotFoundError("Quotation", id);
    }

    const quote = quoteResult.rows[0];

    const linesResult = await query(
      `SELECT ql.id, ql.quotation_id, ql.product_id, p.name as product_name, p.sku as product_sku,
              ql.product_variant_id, pv.name as variant_name, ql.description, ql.quantity,
              ql.unit_price, ql.unit_cost, ql.applied_discount_pct, ql.discount_amount,
              ql.line_subtotal, ql.line_total, ql.line_cost, ql.line_margin,
              ql.created_at, ql.updated_at
       FROM quotation_lines ql
       JOIN products p ON ql.product_id = p.id
       LEFT JOIN product_variants pv ON ql.product_variant_id = pv.id
       WHERE ql.quotation_id = $1
       ORDER BY ql.id ASC`,
      [quote.id]
    );

    res.json({
      data: {
        ...quote,
        id: Number(quote.id),
        customer_id: Number(quote.customer_id),
        sales_rep_id: Number(quote.sales_rep_id),
        subtotal: Number(quote.subtotal),
        discount_total: Number(quote.discount_total),
        tax_rate_pct: Number(quote.tax_rate_pct),
        tax_total: Number(quote.tax_total),
        grand_total: Number(quote.grand_total),
        total_cost: Number(quote.total_cost),
        margin_amount: Number(quote.margin_amount),
        margin_pct: Number(quote.margin_pct),
        total_overage: Number(quote.total_overage),
        lines: linesResult.rows.map((l) => ({
          ...l,
          id: Number(l.id),
          quotation_id: Number(l.quotation_id),
          product_id: Number(l.product_id),
          product_variant_id: l.product_variant_id ? Number(l.product_variant_id) : null,
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price),
          unit_cost: Number(l.unit_cost),
          applied_discount_pct: Number(l.applied_discount_pct),
          discount_amount: Number(l.discount_amount),
          line_subtotal: Number(l.line_subtotal),
          line_total: Number(l.line_total),
          line_cost: Number(l.line_cost),
          line_margin: Number(l.line_margin),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/quotations
quotationsRouter.post("/", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const data = createQuotationSchema.parse(req.body);

    // Resolve customer's tier & currency
    const customerResult = await query(
      `SELECT id, currency_code FROM customers WHERE id = $1`,
      [data.customer_id]
    );

    if (customerResult.rows.length === 0) {
      throw new NotFoundError("Customer", data.customer_id);
    }

    const customer = customerResult.rows[0];

    // Generate unique quote number: QT-YYYY-XXXX
    const year = new Date().getFullYear();
    const countResult = await query(`SELECT COUNT(*) FROM quotations`);
    const nextSeq = parseInt(countResult.rows[0].count) + 1;
    const quotationNumber = `QT-${year}-${String(nextSeq).padStart(4, "0")}`;

    const insertResult = await query(
      `INSERT INTO quotations (quotation_number, customer_id, sales_rep_id, currency_code, tax_rate_pct, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [quotationNumber, data.customer_id, userId, customer.currency_code, data.tax_rate_pct, data.notes || null]
    );

    const row = insertResult.rows[0];
    res.status(201).json({
      data: {
        ...row,
        id: Number(row.id),
        customer_id: Number(row.customer_id),
        sales_rep_id: Number(row.sales_rep_id),
        subtotal: Number(row.subtotal),
        discount_total: Number(row.discount_total),
        tax_rate_pct: Number(row.tax_rate_pct),
        tax_total: Number(row.tax_total),
        grand_total: Number(row.grand_total),
        margin_amount: Number(row.margin_amount),
        margin_pct: Number(row.margin_pct),
        lines: [],
      },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/quotations/:id
quotationsRouter.patch("/:id", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const isNumeric = /^\d+$/.test(id);
    const fields = patchQuotationSchema.parse(req.body);

    const check = await query(`SELECT id FROM quotations WHERE ${isNumeric ? "id = $1" : "public_id::text = $1"}`, [id]);
    if (check.rows.length === 0) {
      throw new NotFoundError("Quotation", id);
    }
    const realId = check.rows[0].id;

    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length > 0) {
      const setClauses = entries.map(([k], i) => `${k} = $${i + 1}`);
      const values = entries.map(([, v]) => v);

      await query(
        `UPDATE quotations SET ${setClauses.join(", ")}, updated_at = NOW() WHERE id = $${entries.length + 1}`,
        [...values, realId]
      );
    }

    const updated = await recalculateAndPersistQuotation(realId);
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/quotations/:id/lines
quotationsRouter.post("/:id/lines", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const isNumeric = /^\d+$/.test(id);
    const data = addLineSchema.parse(req.body);

    // Fetch quote detail for customer tier & currency
    const quoteResult = await query(
      `SELECT q.id, q.currency_code, c.tier_id as customer_tier_id
       FROM quotations q
       JOIN customers c ON q.customer_id = c.id
       WHERE ${isNumeric ? "q.id = $1" : "q.public_id::text = $1"}`,
      [id]
    );

    if (quoteResult.rows.length === 0) {
      throw new NotFoundError("Quotation", id);
    }

    const quote = quoteResult.rows[0];

    // Fetch product details & base cost
    const productResult = await query(
      `SELECT id, name, base_cost FROM products WHERE id = $1`,
      [data.product_id]
    );

    if (productResult.rows.length === 0) {
      throw new NotFoundError("Product", data.product_id);
    }

    const product = productResult.rows[0];
    const unitCost = Number(product.base_cost);

    // Resolve snapshot unit_price from Tier x Currency price list
    const priceListEntries = await query(
      `SELECT pli.price_list_id, pl.name as price_list_name, pl.customer_tier_id,
              pl.currency_code, pli.product_id, pli.unit_price
       FROM price_list_items pli
       JOIN price_lists pl ON pli.price_list_id = pl.id
       WHERE pli.product_id = $1 AND pl.customer_tier_id = $2 AND pl.currency_code = $3 AND pl.is_active = true`,
      [data.product_id, quote.customer_tier_id, quote.currency_code]
    );

    let unitPrice = unitCost * 1.3; // Fallback 30% markup if no price list item
    if (priceListEntries.rows.length > 0) {
      const match = resolveUnitPrice(
        priceListEntries.rows,
        data.product_id,
        quote.customer_tier_id,
        quote.currency_code
      );
      if (match.unitPrice !== null) {
        unitPrice = match.unitPrice;
      }
    }

    // Temporary calculations
    const qty = data.quantity;
    const discPct = data.applied_discount_pct;
    const subtotal = qty * unitPrice;
    const discAmt = subtotal * (discPct / 100);
    const lineTotal = subtotal - discAmt;
    const lineCost = qty * unitCost;
    const lineMargin = lineTotal - lineCost;

    await query(
      `INSERT INTO quotation_lines
         (quotation_id, product_id, product_variant_id, description, quantity,
          unit_price, unit_cost, applied_discount_pct, discount_amount,
          line_subtotal, line_total, line_cost, line_margin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        quote.id,
        data.product_id,
        data.product_variant_id || null,
        data.description || product.name,
        qty,
        unitPrice,
        unitCost,
        discPct,
        discAmt,
        subtotal,
        lineTotal,
        lineCost,
        lineMargin,
      ]
    );

    const updatedQuote = await recalculateAndPersistQuotation(quote.id);
    res.status(201).json({ data: updatedQuote });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/quotations/:id/lines/:lineId
quotationsRouter.patch("/:id/lines/:lineId", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, lineId } = req.params;
    const fields = patchLineSchema.parse(req.body);

    const lineCheck = await query(
      `SELECT id FROM quotation_lines WHERE id = $1 AND quotation_id = $2`,
      [lineId, id]
    );

    if (lineCheck.rows.length === 0) {
      throw new NotFoundError("QuotationLine", lineId);
    }

    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length > 0) {
      const setClauses = entries.map(([k], i) => `${k} = $${i + 1}`);
      const values = entries.map(([, v]) => v);

      await query(
        `UPDATE quotation_lines SET ${setClauses.join(", ")}, updated_at = NOW() WHERE id = $${entries.length + 1}`,
        [...values, lineId]
      );
    }

    const updatedQuote = await recalculateAndPersistQuotation(id);
    res.json({ data: updatedQuote });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/quotations/:id/lines/:lineId
quotationsRouter.delete("/:id/lines/:lineId", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, lineId } = req.params;

    const result = await query(
      `DELETE FROM quotation_lines WHERE id = $1 AND quotation_id = $2 RETURNING id`,
      [lineId, id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("QuotationLine", lineId);
    }

    const updatedQuote = await recalculateAndPersistQuotation(id);
    res.json({ data: updatedQuote });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/quotations/:id/recalculate
quotationsRouter.post("/:id/recalculate", requireRole(ROLES.ADMIN, ROLES.SALES_REP, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const updatedQuote = await recalculateAndPersistQuotation(id);
    res.json({ data: updatedQuote });
  } catch (err) {
    next(err);
  }
});
