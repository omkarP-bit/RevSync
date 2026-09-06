import { Router, Request, Response, NextFunction } from "express";
import { query } from "../../database/pool.js";
import { authenticate, requireRole, ROLES } from "../../middleware/auth.js";
import { ConflictError, NotFoundError, UnprocessableEntityError, ValidationError } from "../../shared/errors.js";
import { writeAuditLog } from "../../shared/audit.js";
import { computeFulfillmentStatus } from "../../engines/fulfillment-engine.js";
import { z } from "zod";
import { createFulfillmentForQuotation } from "./fulfillment-service.js";

export const warehousesRouter = Router();
warehousesRouter.use(authenticate);

export const fulfillmentRouter = Router();
fulfillmentRouter.use(authenticate);

const warehouseSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(50),
  address: z.string().max(2000).optional().nullable(),
  base_shipping_cost: z.number().min(0).max(1000000).optional(),
  is_active: z.boolean().optional(),
});

const inventorySchema = z.object({
  product_id: z.number().int().positive(),
  quantity_on_hand: z.number().int().min(0),
  reorder_threshold: z.number().int().min(0).optional(),
});

const overrideSchema = z.object({
  allocations: z
    .array(
      z.object({
        product_id: z.number().int().positive(),
        warehouse_id: z.number().int().positive(),
        quantity: z.number().int().min(0),
      })
    )
    .min(1),
});

// GET /api/v1/warehouses (paginated)
warehousesRouter.get("/", requireRole(ROLES.ADMIN, ROLES.WAREHOUSE_MANAGER, ROLES.FINANCE, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (req.query.is_active !== undefined) {
      where.push(`w.is_active = $${paramIdx++}`);
      params.push(req.query.is_active === "true");
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const countResult = await query(
      `SELECT COUNT(*) FROM warehouses w ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT w.id, w.name, w.code, w.address, w.base_shipping_cost, w.is_active,
              w.created_at, w.updated_at
       FROM warehouses w
       ${whereClause}
       ORDER BY w.code ASC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    res.json({
      data: result.rows.map((row) => ({
        ...row,
        id: Number(row.id),
        base_shipping_cost: Number(row.base_shipping_cost),
      })),
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/warehouses (Admin only)
warehousesRouter.post("/", requireRole(ROLES.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = warehouseSchema.parse(req.body);
    const userId = (req as any).user.userId;

    const conflict = await query(`SELECT id FROM warehouses WHERE code = $1`, [data.code]);
    if (conflict.rows.length > 0) {
      throw new ConflictError("A warehouse with this code already exists");
    }

    const result = await query(
      `INSERT INTO warehouses (name, code, address, base_shipping_cost, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [data.name, data.code, data.address ?? null, data.base_shipping_cost ?? 0, data.is_active ?? true]
    );

    const row = result.rows[0];
    await writeAuditLog({
      entityType: "warehouses",
      entityId: row.id,
      action: "WAREHOUSE_CREATED",
      before: null,
      after: {
        name: row.name,
        code: row.code,
        base_shipping_cost: Number(row.base_shipping_cost),
        is_active: row.is_active,
      },
      performedBy: userId,
      reason: "Warehouse configured",
    });

    res.status(201).json({
      data: { ...row, id: Number(row.id), base_shipping_cost: Number(row.base_shipping_cost) },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/warehouses/:id (Admin only)
warehousesRouter.patch("/:id", requireRole(ROLES.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.userId;
    const fields = warehouseSchema.partial().parse(req.body);
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);

    if (entries.length === 0) {
      throw new ValidationError("No fields to update");
    }

    const before = await query(`SELECT * FROM warehouses WHERE id = $1`, [id]);
    if (before.rows.length === 0) {
      throw new NotFoundError("Warehouse", id);
    }
    if (fields.code !== undefined) {
      const codeConflict = await query(
        `SELECT id FROM warehouses WHERE code = $1 AND id <> $2`,
        [fields.code, id]
      );
      if (codeConflict.rows.length > 0) {
        throw new ConflictError("A warehouse with this code already exists");
      }
    }

    const setClauses = entries.map(([key], i) => `${key} = $${i + 1}`);
    const values = entries.map(([, v]) => v);

    const result = await query(
      `UPDATE warehouses SET ${setClauses.join(", ")}, updated_at = NOW()
       WHERE id = $${entries.length + 1}
       RETURNING *`,
      [...values, id]
    );

    const row = result.rows[0];
    await writeAuditLog({
      entityType: "warehouses",
      entityId: row.id,
      action: "WAREHOUSE_UPDATED",
      before: before.rows[0],
      after: row,
      performedBy: userId,
      reason: "Warehouse updated",
    });

    res.json({
      data: { ...row, id: Number(row.id), base_shipping_cost: Number(row.base_shipping_cost) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/warehouses/:id/inventory (paginated by product)
warehousesRouter.get("/:id/inventory", requireRole(ROLES.ADMIN, ROLES.WAREHOUSE_MANAGER, ROLES.FINANCE, ROLES.SALES_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const exists = await query(`SELECT id FROM warehouses WHERE id = $1`, [id]);
    if (exists.rows.length === 0) {
      throw new NotFoundError("Warehouse", id);
    }

    const countResult = await query(
      `SELECT COUNT(*) FROM inventory_items ii
       JOIN products p ON ii.product_id = p.id
       WHERE ii.warehouse_id = $1 AND p.track_inventory = true`,
      [id]
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT ii.id, ii.product_id, p.name AS product_name, p.sku,
              ii.quantity_on_hand, ii.reorder_threshold, ii.updated_at
       FROM inventory_items ii
       JOIN products p ON ii.product_id = p.id
       WHERE ii.warehouse_id = $1 AND p.track_inventory = true
       ORDER BY p.name ASC
       LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    );

    res.json({
      data: result.rows.map((row) => ({
        ...row,
        id: Number(row.id),
        product_id: Number(row.product_id),
        quantity_on_hand: Number(row.quantity_on_hand),
        reorder_threshold: Number(row.reorder_threshold),
      })),
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/warehouses/:id/inventory (upsert stock level for a product)
warehousesRouter.post("/:id/inventory", requireRole(ROLES.ADMIN, ROLES.WAREHOUSE_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.userId;
    const data = inventorySchema.parse(req.body);

    const warehouseCheck = await query(`SELECT name FROM warehouses WHERE id = $1`, [id]);
    if (warehouseCheck.rows.length === 0) {
      throw new NotFoundError("Warehouse", id);
    }
    const productCheck = await query(`SELECT name, track_inventory FROM products WHERE id = $1`, [data.product_id]);
    if (productCheck.rows.length === 0) {
      throw new NotFoundError("Product", data.product_id);
    }
    if (!productCheck.rows[0].track_inventory) {
      throw new UnprocessableEntityError(
        `"${productCheck.rows[0].name}" is not tracked in inventory (software/digital products are excluded from per-region stock)`
      );
    }

    const before = await query(
      `SELECT * FROM inventory_items WHERE warehouse_id = $1 AND product_id = $2`,
      [id, data.product_id]
    );

    const result = await query(
      `INSERT INTO inventory_items (warehouse_id, product_id, quantity_on_hand, reorder_threshold)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (warehouse_id, product_id)
       DO UPDATE SET quantity_on_hand = $3,
                     reorder_threshold = COALESCE($4, inventory_items.reorder_threshold),
                     updated_at = NOW()
       RETURNING *`,
      [id, data.product_id, data.quantity_on_hand, data.reorder_threshold ?? null]
    );

    const row = result.rows[0];
    await writeAuditLog({
      entityType: "inventory_items",
      entityId: row.id,
      action: before.rows.length > 0 ? "INVENTORY_UPDATED" : "INVENTORY_CREATED",
      before: before.rows[0] ?? null,
      after: { ...row, quantity_on_hand: Number(row.quantity_on_hand) },
      performedBy: userId,
      reason: "Stock level adjusted",
    });

    res.status(201).json({
      data: {
        ...row,
        id: Number(row.id),
        product_id: Number(row.product_id),
        warehouse_id: Number(row.warehouse_id),
        quantity_on_hand: Number(row.quantity_on_hand),
        reorder_threshold: Number(row.reorder_threshold),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---- Fulfillment Orders ----

const ORDER_STATUSES = ["ALLOCATED", "PARTIAL", "BACKORDERED", "SHIPPED", "CANCELLED"] as const;

async function loadOrder(id: string): Promise<any> {
  const result = await query(
    `SELECT fo.id, fo.quotation_id, fo.status, fo.shipping_cost, fo.backordered_quantity,
            fo.shipped_at, fo.created_at, fo.updated_at, fo.notes,
            q.quotation_number, q.customer_id, c.name AS customer_name, q.grand_total
     FROM fulfillment_orders fo
     JOIN quotations q ON fo.quotation_id = q.id
     JOIN customers c ON q.customer_id = c.id
     WHERE fo.id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError("Fulfillment order", id);
  }

  const order = result.rows[0];
  const allocations = await query(
    `SELECT fa.id, fa.quotation_line_id, fa.product_id, p.name AS product_name,
            fa.warehouse_id, w.name AS warehouse_name, w.code AS warehouse_code,
            fa.quantity, fa.unit_shipping_cost
     FROM fulfillment_allocations fa
     JOIN products p ON fa.product_id = p.id
     JOIN warehouses w ON fa.warehouse_id = w.id
     WHERE fa.fulfillment_order_id = $1
     ORDER BY fa.id ASC`,
    [id]
  );

  return {
    id: Number(order.id),
    quotation_id: Number(order.quotation_id),
    status: order.status,
    shipping_cost: Number(order.shipping_cost),
    backordered_quantity: Number(order.backordered_quantity),
    shipped_at: order.shipped_at,
    created_at: order.created_at,
    updated_at: order.updated_at,
    notes: order.notes,
    quotation_number: order.quotation_number,
    customer_id: Number(order.customer_id),
    customer_name: order.customer_name,
    grand_total: Number(order.grand_total),
    allocations: allocations.rows.map((row) => ({
      id: Number(row.id),
      quotation_line_id: Number(row.quotation_line_id),
      product_id: Number(row.product_id),
      product_name: row.product_name,
      warehouse_id: Number(row.warehouse_id),
      warehouse_name: row.warehouse_name,
      warehouse_code: row.warehouse_code,
      quantity: Number(row.quantity),
      unit_shipping_cost: Number(row.unit_shipping_cost),
    })),
  };
}

// GET /api/v1/fulfillment (paginated)
fulfillmentRouter.get("/", requireRole(ROLES.ADMIN, ROLES.WAREHOUSE_MANAGER, ROLES.SALES_MANAGER, ROLES.FINANCE, ROLES.SALES_REP), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (req.query.status) {
      const status = (req.query.status as string).toUpperCase().replace(" ", "_");
      if (!(ORDER_STATUSES as readonly string[]).includes(status)) {
        throw new ValidationError("Invalid fulfillment status");
      }
      where.push(`fo.status = $${paramIdx++}`);
      params.push(status);
    }
    if (req.query.quotation_id) {
      where.push(`fo.quotation_id = $${paramIdx++}`);
      params.push(parseInt(req.query.quotation_id as string));
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const countResult = await query(
      `SELECT COUNT(*) FROM fulfillment_orders fo ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT fo.id, fo.quotation_id, fo.status, fo.shipping_cost, fo.backordered_quantity,
              fo.created_at, fo.updated_at,
              q.quotation_number, c.name AS customer_name
       FROM fulfillment_orders fo
       JOIN quotations q ON fo.quotation_id = q.id
       JOIN customers c ON q.customer_id = c.id
       ${whereClause}
       ORDER BY fo.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    res.json({
      data: result.rows.map((row) => ({
        id: Number(row.id),
        quotation_id: Number(row.quotation_id),
        status: row.status as (typeof ORDER_STATUSES)[number],
        shipping_cost: Number(row.shipping_cost),
        backordered_quantity: Number(row.backordered_quantity),
        created_at: row.created_at,
        updated_at: row.updated_at,
        quotation_number: row.quotation_number,
        customer_name: row.customer_name,
      })),
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/fulfillment — create an order from a CONFIRMED quotation (auto-allocate)
fulfillmentRouter.post("/", requireRole(ROLES.ADMIN, ROLES.WAREHOUSE_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const schema = z.object({
      quotation_id: z.number().int().positive(),
      notes: z.string().max(2000).optional().nullable(),
    });
    const data = schema.parse(req.body);

    const quoteResult = await query(
      `SELECT id, status FROM quotations WHERE id = $1`,
      [data.quotation_id]
    );
    if (quoteResult.rows.length === 0) {
      throw new NotFoundError("Quotation", data.quotation_id);
    }
    if (quoteResult.rows[0].status !== "CONFIRMED") {
      throw new UnprocessableEntityError("Only CONFIRMED quotations can be fulfilled");
    }

    const result = await createFulfillmentForQuotation(query, data.quotation_id, userId, {
      notes: data.notes ?? null,
    });

    res.status(201).json({ data: await loadOrder(String(result.orderId)) });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/fulfillment/:id
fulfillmentRouter.get("/:id", requireRole(ROLES.ADMIN, ROLES.WAREHOUSE_MANAGER, ROLES.SALES_MANAGER, ROLES.FINANCE, ROLES.SALES_REP), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ data: await loadOrder(req.params.id) });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/fulfillment/:id/override — manual warehouse allocation replacement
fulfillmentRouter.post("/:id/override", requireRole(ROLES.ADMIN, ROLES.WAREHOUSE_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.userId;
    const data = overrideSchema.parse(req.body);

    const orderResult = await query(`SELECT * FROM fulfillment_orders WHERE id = $1`, [id]);
    if (orderResult.rows.length === 0) {
      throw new NotFoundError("Fulfillment order", id);
    }
    const order = orderResult.rows[0];
    if (order.status === "SHIPPED" || order.status === "CANCELLED") {
      throw new UnprocessableEntityError("Cannot override a shipped or cancelled fulfillment order");
    }

    const linesResult = await query(
      `SELECT product_id, SUM(quantity)::int AS requested
       FROM quotation_lines
       WHERE quotation_id = $1
       GROUP BY product_id`,
      [order.quotation_id]
    );
    const requestedByProduct = new Map<number, number>(
      linesResult.rows.map((r: any) => [Number(r.product_id), Number(r.requested)])
    );

    const currentResult = await query(
      `SELECT fa.id, fa.product_id, fa.warehouse_id, fa.quantity, fa.quotation_line_id
       FROM fulfillment_allocations fa
       WHERE fa.fulfillment_order_id = $1`,
      [id]
    );
    const allocationsByKey = new Map<string, any>(
      currentResult.rows.map((r: any) => [`${Number(r.product_id)}:${Number(r.warehouse_id)}`, r])
    );

    const warehousesResult = await query(
      `SELECT id FROM warehouses WHERE id = ANY($1::bigint[]) AND is_active = true`,
      [data.allocations.map((a: any) => a.warehouse_id)]
    );
    const validWarehouses = new Set(warehousesResult.rows.map((r: any) => Number(r.id)));

    const lineResult = await query(
      `SELECT ql.id, ql.product_id, p.track_inventory
       FROM fulfillment_orders fo
       JOIN quotation_lines ql ON ql.quotation_id = fo.quotation_id
       JOIN products p ON p.id = ql.product_id
       WHERE fo.id = $1`,
      [id]
    );
    const lineIdByProduct = new Map<number, number>(
      lineResult.rows.map((r: any) => [Number(r.product_id), Number(r.id)])
    );
    const trackInventoryByProduct = new Map<number, boolean>(
      lineResult.rows.map((r: any) => [Number(r.product_id), Boolean(r.track_inventory)])
    );

    const currentByProduct = new Map<number, number>();
    for (const alloc of currentResult.rows as any[]) {
      const pid = Number(alloc.product_id);
      currentByProduct.set(pid, (currentByProduct.get(pid) ?? 0) + Number(alloc.quantity));
    }

    // Validate every entry (product belongs to the quotation, warehouse is active)
    // and check the FINAL end-state totals per product — independent of entry order —
    // so a net reallocation between warehouses is allowed even mid-transition.
    for (const entry of data.allocations) {
      if (!requestedByProduct.has(entry.product_id)) {
        throw new UnprocessableEntityError(`Product ${entry.product_id} is not part of this quotation`);
      }
      if (!trackInventoryByProduct.get(entry.product_id)) {
        throw new UnprocessableEntityError(
          `Product ${entry.product_id} is delivered digitally and cannot be allocated to a warehouse`
        );
      }
      if (!validWarehouses.has(entry.warehouse_id)) {
        throw new UnprocessableEntityError(`Warehouse ${entry.warehouse_id} is not active`);
      }
    }

    const desiredByKey = new Map<string, number>();
    for (const entry of data.allocations) {
      desiredByKey.set(`${entry.product_id}:${entry.warehouse_id}`, entry.quantity);
    }

    const finalByProduct = new Map(currentByProduct);
    for (const entry of data.allocations) {
      const productId = entry.product_id;
      const key = `${productId}:${entry.warehouse_id}`;
      const finalTotal =
        (finalByProduct.get(productId) ?? 0) -
        (allocationsByKey.has(key) ? Number(allocationsByKey.get(key).quantity) : 0) +
        entry.quantity;
      finalByProduct.set(productId, finalTotal);
    }
    for (const [productId, finalTotal] of finalByProduct) {
      const requested = requestedByProduct.get(productId);
      if (requested !== undefined && finalTotal > requested) {
        throw new UnprocessableEntityError(
          `Product ${productId} total allocation (${finalTotal}) exceeds requested (${requested})`
        );
      }
    }

    for (const [key, quantity] of desiredByKey) {
      const [productId, warehouseId] = key.split(":").map(Number);

      if (quantity === 0) {
        if (allocationsByKey.has(key)) {
          await query(
            `DELETE FROM fulfillment_allocations WHERE id = $1`,
            [allocationsByKey.get(key).id]
          );
        }
      } else if (allocationsByKey.has(key)) {
        await query(
          `UPDATE fulfillment_allocations SET quantity = $1 WHERE id = $2`,
          [quantity, allocationsByKey.get(key).id]
        );
      } else {
        await query(
          `INSERT INTO fulfillment_allocations
             (fulfillment_order_id, quotation_line_id, product_id, warehouse_id, quantity, unit_shipping_cost)
           VALUES ($1, $2, $3, $4, $5,
             (SELECT base_shipping_cost FROM warehouses WHERE id = $4))`,
          [id, lineIdByProduct.get(productId), productId, warehouseId, quantity]
        );
      }
    }

    const recalcResult = await query(
      `SELECT COALESCE(SUM(quantity), 0)::int AS allocated, COUNT(*)::int AS cnt
       FROM fulfillment_allocations
       WHERE fulfillment_order_id = $1`,
      [id]
    );
    const allocatedTotal = Number(recalcResult.rows[0].allocated);
    const requestedTotal = [...requestedByProduct.values()].reduce((a, b) => a + b, 0);
    const backordered = Math.max(0, requestedTotal - allocatedTotal);
    const status = computeFulfillmentStatus(allocatedTotal, backordered);

    const shippingResult = await query(
      `SELECT COALESCE(SUM(unit_shipping_cost * quantity), 0)::numeric AS total
       FROM fulfillment_allocations
       WHERE fulfillment_order_id = $1`,
      [id]
    );

    await query(
      `UPDATE fulfillment_orders
       SET status = $1, backordered_quantity = $2, shipping_cost = $3, updated_at = NOW()
       WHERE id = $4`,
      [status, backordered, Number(shippingResult.rows[0].total).toFixed(2), id]
    );

    await writeAuditLog({
      entityType: "fulfillment_orders",
      entityId: id,
      action: "FULFILLMENT_OVERRIDDEN",
      before: { status: order.status },
      after: { status, backordered_quantity: backordered, overrides: data.allocations.length },
      performedBy: userId,
      reason: "Manual warehouse allocation override",
    });

    res.json({ data: await loadOrder(String(id)) });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/fulfillment/:id/ship — deduct inventory and mark shipped
fulfillmentRouter.post("/:id/ship", requireRole(ROLES.ADMIN, ROLES.WAREHOUSE_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.userId;

    const orderResult = await query(`SELECT * FROM fulfillment_orders WHERE id = $1`, [id]);
    if (orderResult.rows.length === 0) {
      throw new NotFoundError("Fulfillment order", id);
    }
    const order = orderResult.rows[0];
    if (order.status === "SHIPPED" || order.status === "CANCELLED") {
      throw new UnprocessableEntityError("This fulfillment order has already been shipped or cancelled");
    }

    const allocationsResult = await query(
      `SELECT warehouse_id, product_id, quantity FROM fulfillment_allocations WHERE fulfillment_order_id = $1`,
      [id]
    );

    for (const alloc of allocationsResult.rows as any[]) {
      const updated = await query(
        `UPDATE inventory_items
         SET quantity_on_hand = quantity_on_hand - $1, updated_at = NOW()
         WHERE warehouse_id = $2 AND product_id = $3 AND quantity_on_hand >= $1
         RETURNING id`,
        [Number(alloc.quantity), Number(alloc.warehouse_id), Number(alloc.product_id)]
      );
      if (updated.rows.length === 0) {
        throw new ConflictError("Insufficient on-hand stock to ship this allocation");
      }
    }

    await query(
      `UPDATE fulfillment_orders
       SET status = 'SHIPPED', shipped_at = NOW(), backordered_quantity = 0, updated_at = NOW()
       WHERE id = $1`,
      [id]
    );

    await writeAuditLog({
      entityType: "fulfillment_orders",
      entityId: id,
      action: "FULFILLMENT_SHIPPED",
      before: { status: order.status },
      after: { status: "SHIPPED", allocations: allocationsResult.rows.length },
      performedBy: userId,
      reason: "Order shipped",
    });

    res.json({ data: await loadOrder(String(id)) });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/fulfillment/:id/cancel
fulfillmentRouter.post("/:id/cancel", requireRole(ROLES.ADMIN, ROLES.WAREHOUSE_MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.userId;

    const orderResult = await query(`SELECT * FROM fulfillment_orders WHERE id = $1`, [id]);
    if (orderResult.rows.length === 0) {
      throw new NotFoundError("Fulfillment order", id);
    }
    const order = orderResult.rows[0];
    if (order.status === "SHIPPED") {
      throw new UnprocessableEntityError("Cannot cancel a shipped fulfillment order");
    }

    await query(
      `UPDATE fulfillment_orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`,
      [id]
    );

    await writeAuditLog({
      entityType: "fulfillment_orders",
      entityId: id,
      action: "FULFILLMENT_CANCELLED",
      before: { status: order.status },
      after: { status: "CANCELLED" },
      performedBy: userId,
      reason: "Fulfillment order cancelled",
    });

    res.json({ data: await loadOrder(String(id)) });
  } catch (err) {
    next(err);
  }
});