export interface AllocationItem {
  quotationLineId: number;
  productId: number;
  quantity: number;
}

export interface WarehouseContext {
  id: number;
  shippingCost: number;
  shipmentCount: number;
  stock: Record<number, number>;
}

export interface AllocationLine {
  quotationLineId: number;
  productId: number;
  warehouseId: number;
  quantity: number;
  unitShippingCost: number;
}

export interface BackorderLine {
  productId: number;
  quantity: number;
}

export interface AllocationOutcome {
  allocations: AllocationLine[];
  backorders: BackorderLine[];
  requestedQuantity: number;
  allocatedQuantity: number;
  backorderedQuantity: number;
  fullyCovered: boolean;
}

export type FulfillmentStatus = "ALLOCATED" | "PARTIAL" | "BACKORDERED";

// Deterministic multi-warehouse allocation.
// For every requested line (in input order), candidate warehouses that hold stock for the
// product are ranked by (base shipping cost ASC, existing shipment count ASC, id ASC), then
// the requested quantity is consumed greedily from the cheapest candidates first. Any
// shortfall after exhausting every warehouse is recorded as a backorder.
export function allocateFulfillment(
  items: AllocationItem[],
  warehouses: WarehouseContext[]
): AllocationOutcome {
  const stockByWarehouse = new Map<number, Record<number, number>>(
    warehouses.map((w) => [w.id, { ...w.stock }])
  );

  const allocations: AllocationLine[] = [];
  const backorders: BackorderLine[] = [];
  let requestedQuantity = 0;
  let allocatedQuantity = 0;

  for (const item of items) {
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) continue;
    requestedQuantity += quantity;

    const candidates = warehouses
      .filter((w) => (stockByWarehouse.get(w.id)?.[item.productId] ?? 0) > 0)
      .sort((a, b) => {
        if (Number(a.shippingCost) !== Number(b.shippingCost)) {
          return Number(a.shippingCost) - Number(b.shippingCost);
        }
        if (a.shipmentCount !== b.shipmentCount) {
          return a.shipmentCount - b.shipmentCount;
        }
        return a.id - b.id;
      });

    let remaining = quantity;
    for (const warehouse of candidates) {
      if (remaining <= 0) break;
      const available = stockByWarehouse.get(warehouse.id)![item.productId];
      const taken = Math.min(remaining, available);
      if (taken <= 0) continue;

      stockByWarehouse.get(warehouse.id)![item.productId] = available - taken;
      remaining -= taken;
      allocatedQuantity += taken;
      allocations.push({
        quotationLineId: item.quotationLineId,
        productId: item.productId,
        warehouseId: warehouse.id,
        quantity: taken,
        unitShippingCost: Number(warehouse.shippingCost),
      });
    }

    if (remaining > 0) {
      backorders.push({ productId: item.productId, quantity: remaining });
    }
  }

  const backorderedQuantity = backorders.reduce((sum, line) => sum + line.quantity, 0);

  return {
    allocations,
    backorders,
    requestedQuantity,
    allocatedQuantity,
    backorderedQuantity,
    fullyCovered: backorderedQuantity === 0,
  };
}

// Map an allocation outcome to the fulfillment order status.
export function computeFulfillmentStatus(
  allocatedQuantity: number,
  backorderedQuantity: number
): FulfillmentStatus {
  if (backorderedQuantity > 0) {
    return allocatedQuantity > 0 ? "PARTIAL" : "BACKORDERED";
  }
  return "ALLOCATED";
}