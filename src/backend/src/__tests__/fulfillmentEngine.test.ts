import { describe, it, expect } from "vitest";
import {
  allocateFulfillment,
  computeFulfillmentStatus,
  WarehouseContext,
} from "../engines/fulfillment-engine.js";

const warehouse = (id: number, opts: Partial<WarehouseContext> = {}): WarehouseContext => ({
  id,
  shippingCost: 0,
  shipmentCount: 0,
  stock: {},
  ...opts,
});

describe("fulfillment engine", () => {
  it("allocates from the cheapest warehouse first", () => {
    const outcome = allocateFulfillment(
      [{ quotationLineId: 1, productId: 1, quantity: 3 }],
      [
        warehouse(2, { shippingCost: 10, stock: { 1: 10 } }),
        warehouse(1, { shippingCost: 5, stock: { 1: 10 } }),
      ]
    );

    expect(outcome.fullyCovered).toBe(true);
    expect(outcome.backorders).toEqual([]);
    expect(outcome.allocations).toEqual([
      { quotationLineId: 1, productId: 1, warehouseId: 1, quantity: 3, unitShippingCost: 5 },
    ]);
  });

  it("splits an order across warehouses when the cheapest has limited stock", () => {
    const outcome = allocateFulfillment(
      [{ quotationLineId: 1, productId: 1, quantity: 5 }],
      [
        warehouse(1, { shippingCost: 5, stock: { 1: 3 } }),
        warehouse(2, { shippingCost: 5, stock: { 1: 10 } }),
      ]
    );

    expect(outcome.fullyCovered).toBe(true);
    expect(outcome.allocations).toHaveLength(2);
    expect(outcome.allocations[0]).toMatchObject({ warehouseId: 1, quantity: 3 });
    expect(outcome.allocations[1]).toMatchObject({ warehouseId: 2, quantity: 2 });
  });

  it("breaks shipping-cost ties by existing shipment count then id", () => {
    const outcome = allocateFulfillment(
      [{ quotationLineId: 1, productId: 1, quantity: 3 }],
      [
        warehouse(3, { shippingCost: 5, shipmentCount: 2, stock: { 1: 1 } }),
        warehouse(1, { shippingCost: 5, shipmentCount: 1, stock: { 1: 1 } }),
        warehouse(2, { shippingCost: 5, shipmentCount: 1, stock: { 1: 1 } }),
      ]
    );

    expect(outcome.allocations.map((a) => a.warehouseId)).toEqual([1, 2, 3]);
    expect(outcome.fullyCovered).toBe(true);
  });

  it("records a backorder when total stock is insufficient", () => {
    const outcome = allocateFulfillment(
      [
        { quotationLineId: 1, productId: 1, quantity: 10 },
        { quotationLineId: 2, productId: 2, quantity: 0 },
      ],
      [warehouse(1, { stock: { 1: 6 } }), warehouse(2, { stock: { 1: 2, 2: 5 } })]
    );

    expect(outcome.fullyCovered).toBe(false);
    expect(outcome.allocatedQuantity).toBe(8);
    expect(outcome.requestedQuantity).toBe(10);
    expect(outcome.backorders).toEqual([{ productId: 1, quantity: 2 }]);
    // zero-quantity lines are ignored
    expect(outcome.requestedQuantity).not.toBeGreaterThan(10);
  });

  it("keeps warehouse stock accounting independent across products", () => {
    const outcome = allocateFulfillment(
      [
        { quotationLineId: 1, productId: 1, quantity: 2 },
        { quotationLineId: 2, productId: 2, quantity: 3 },
      ],
      [warehouse(1, { stock: { 1: 10, 2: 10 } })]
    );

    expect(outcome.allocations).toEqual([
      { quotationLineId: 1, productId: 1, warehouseId: 1, quantity: 2, unitShippingCost: 0 },
      { quotationLineId: 2, productId: 2, warehouseId: 1, quantity: 3, unitShippingCost: 0 },
    ]);
    expect(outcome.fullyCovered).toBe(true);
  });

  it("skips warehouses with no stock for a product", () => {
    const outcome = allocateFulfillment(
      [{ quotationLineId: 1, productId: 1, quantity: 5 }],
      [
        warehouse(1, { shippingCost: 0, stock: { 2: 5 } }),
        warehouse(2, { shippingCost: 1, stock: { 1: 5 } }),
      ]
    );

    expect(outcome.allocations).toEqual([
      { quotationLineId: 1, productId: 1, warehouseId: 2, quantity: 5, unitShippingCost: 1 },
    ]);
  });

  it("reduces stock as it consumes it (no double allocation)", () => {
    const outcome = allocateFulfillment(
      [
        { quotationLineId: 1, productId: 1, quantity: 8 },
        { quotationLineId: 2, productId: 1, quantity: 8 },
      ],
      [warehouse(1, { stock: { 1: 10 } })]
    );

    expect(outcome.allocatedQuantity).toBe(10);
    expect(outcome.backorders).toEqual([{ productId: 1, quantity: 6 }]);
  });

  it("computes order status from allocation/backorder totals", () => {
    expect(computeFulfillmentStatus(5, 0)).toBe("ALLOCATED");
    expect(computeFulfillmentStatus(5, 2)).toBe("PARTIAL");
    expect(computeFulfillmentStatus(0, 3)).toBe("BACKORDERED");
  });
});