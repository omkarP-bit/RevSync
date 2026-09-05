import { PoolClient } from "pg";
import { query } from "../../database/pool.js";
import { ConflictError, UnprocessableEntityError } from "../../shared/errors.js";
import { writeAuditLog } from "../../shared/audit.js";
import {
  WarehouseContext,
  allocateFulfillment,
  computeFulfillmentStatus,
} from "../../engines/fulfillment-engine.js";

export interface FulfillmentCreationResult {
  created: boolean;
  reason?: "FULFILLMENT_EXISTS" | "NO_LINES" | "NO_WAREHOUSES";
  orderId?: number;
  status?: string;
  backorderedQuantity?: number;
  allocationCount?: number;
}

export interface FulfillmentCreationOptions {
  skipIfNotFulfillable?: boolean;
  notes?: string | null;
}

/**
 * Auto-allocates stock and creates a fulfillment order for a CONFIRMED quotation.
 * Caller is responsible for ensuring the quotation is CONFIRMED and for wrapping
 * the call in a transaction when a client is supplied.
 *
 * When `skipIfNotFulfillable` is true, non-fatal conditions (existing order, no
 * lines, no active warehouse) return `{ created: false, reason }` instead of throwing,
 * so deal confirmation is never blocked by warehouse setup.
 */
export async function createFulfillmentForQuotation(
  runner: Pick<PoolClient, "query"> | typeof query,
  quotationId: number,
  userId: number,
  opts: FulfillmentCreationOptions = {}
): Promise<FulfillmentCreationResult> {
  const run: (text: string, params?: unknown[]) => Promise<any> =
    typeof (runner as any).query === "function"
      ? (text, params) => (runner as Pick<PoolClient, "query">).query(text, params)
      : (text, params) => (runner as typeof query)(text, params);

  const existing = await run(
    `SELECT id FROM fulfillment_orders WHERE quotation_id = $1`,
    [quotationId]
  );
  if (existing.rows.length > 0) {
    if (opts.skipIfNotFulfillable) return { created: false, reason: "FULFILLMENT_EXISTS" };
    throw new ConflictError("A fulfillment order already exists for this quotation");
  }

  const linesResult = await run(
    `SELECT ql.id AS quotation_line_id, ql.product_id, ql.quantity, p.track_inventory
     FROM quotation_lines ql
     JOIN products p ON p.id = ql.product_id
     WHERE ql.quotation_id = $1
     ORDER BY ql.id ASC`,
    [quotationId]
  );
  const lines = linesResult.rows;
  if (lines.length === 0) {
    if (opts.skipIfNotFulfillable) return { created: false, reason: "NO_LINES" };
    throw new UnprocessableEntityError("Quotation has no lines to fulfill");
  }

  // Products that don't track inventory (software, subscriptions, services) are
  // delivered digitally: they never consume warehouse stock, are never backordered,
  // and produce no shipping cost or allocation rows.
  const trackedLines = lines.filter((r: any) => r.track_inventory);
  const allocatedLines =
    trackedLines.length > 0
      ? trackedLines
      : [];

  let outcome;
  if (allocatedLines.length === 0) {
    outcome = {
      allocations: [],
      backorders: [],
      requestedQuantity: 0,
      allocatedQuantity: 0,
      backorderedQuantity: 0,
      fullyCovered: true,
    };
  } else {
    const warehousesResult = await run(
      `SELECT id, base_shipping_cost FROM warehouses WHERE is_active = true ORDER BY id ASC`
    );
    const warehouses = warehousesResult.rows;
    if (warehouses.length === 0) {
      if (opts.skipIfNotFulfillable) return { created: false, reason: "NO_WAREHOUSES" };
      throw new UnprocessableEntityError("No active warehouses configured");
    }

    const inventoryResult = await run(
      `SELECT product_id, warehouse_id, quantity_on_hand
       FROM inventory_items
       WHERE warehouse_id = ANY($1::bigint[]) AND quantity_on_hand > 0`,
      [warehouses.map((r: any) => Number(r.id))]
    );

    const countResult = await run(
      `SELECT warehouse_id, COUNT(*)::int AS cnt
       FROM fulfillment_allocations
       GROUP BY warehouse_id`
    );
    const shipmentCounts = new Map<number, number>(
      countResult.rows.map((r: any) => [Number(r.warehouse_id), Number(r.cnt)])
    );

    const warehouseContexts: WarehouseContext[] = warehouses.map((w: any) => {
      const wid = Number(w.id);
      const stock: Record<number, number> = {};
      for (const inv of inventoryResult.rows as any[]) {
        if (Number(inv.warehouse_id) === wid) {
          stock[Number(inv.product_id)] = Number(inv.quantity_on_hand);
        }
      }
      return {
        id: wid,
        shippingCost: Number(w.base_shipping_cost),
        shipmentCount: shipmentCounts.get(wid) ?? 0,
        stock,
      };
    });

    outcome = allocateFulfillment(
      allocatedLines.map((r: any) => ({
        quotationLineId: Number(r.quotation_line_id),
        productId: Number(r.product_id),
        quantity: Number(r.quantity),
      })),
      warehouseContexts
    );
  }

  const status = computeFulfillmentStatus(outcome.allocatedQuantity, outcome.backorderedQuantity);
  const shippingCost = outcome.allocations.reduce(
    (sum, line) => sum + Number(line.unitShippingCost) * line.quantity,
    0
  );

  const orderResult = await run(
    `INSERT INTO fulfillment_orders
       (quotation_id, status, shipping_cost, backordered_quantity, created_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, status, shipping_cost, backordered_quantity`,
    [
      quotationId,
      status,
      shippingCost.toFixed(2),
      outcome.backorderedQuantity,
      userId,
      opts.notes ?? (opts.skipIfNotFulfillable ? "Auto-created on quotation confirmation" : null),
    ]
  );
  const order = orderResult.rows[0];

  for (const line of outcome.allocations) {
    await run(
      `INSERT INTO fulfillment_allocations
         (fulfillment_order_id, quotation_line_id, product_id, warehouse_id, quantity, unit_shipping_cost)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        Number(order.id),
        line.quotationLineId,
        line.productId,
        line.warehouseId,
        line.quantity,
        line.unitShippingCost.toFixed(2),
      ]
    );
  }

  await writeAuditLog({
    entityType: "fulfillment_orders",
    entityId: order.id,
    action: opts.skipIfNotFulfillable ? "FULFILLMENT_AUTO_CREATED" : "FULFILLMENT_CREATED",
    before: null,
    after: {
      status,
      shipping_cost: Number(shippingCost.toFixed(2)),
      backordered_quantity: Number(outcome.backorderedQuantity),
      allocation_count: outcome.allocations.length,
    },
    performedBy: userId,
    reason: opts.skipIfNotFulfillable
      ? "Auto-allocated from quotation confirmation"
      : "Auto-allocated from confirmed quotation",
  });

  return {
    created: true,
    orderId: Number(order.id),
    status,
    backorderedQuantity: Number(outcome.backorderedQuantity),
    allocationCount: outcome.allocations.length,
  };
}