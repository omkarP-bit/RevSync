import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import express from "express";
import request from "supertest";
import { warehousesRouter, fulfillmentRouter } from "../modules/fulfillment/fulfillment.routes.js";
import { errorHandler } from "../middleware/errorHandler.js";
import * as db from "../database/pool.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-min-16-chars";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/warehouses", warehousesRouter);
  app.use("/api/v1/fulfillment", fulfillmentRouter);
  app.use(errorHandler);
  return app;
}

const app = createApp();

function token(roleId: number, userId = 3) {
  return jwt.sign({ userId, roleId, email: "u@test.com" }, JWT_SECRET, { expiresIn: "1h" });
}

const adminToken = token(5);
const warehouseToken = token(4);
const financeToken = token(3);
const repToken = token(1);

const emptyResult = { rows: [], rowCount: 0, command: "", oid: 0, fields: [] };
const oneRow = (rows: any[]) => ({ rows, rowCount: rows.length, command: "", oid: 0, fields: [] });

const warehouseRow = {
  id: "1",
  name: "Mumbai Main",
  code: "MUM-01",
  address: "1 BKC, Mumbai",
  base_shipping_cost: "5.00",
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const inventoryRow = {
  id: "9",
  product_id: "1",
  product_name: "Enterprise Platform",
  sku: "SW-ENT-001",
  quantity_on_hand: 12,
  reorder_threshold: 3,
  updated_at: new Date().toISOString(),
};

const orderRow = {
  id: "1",
  quotation_id: "7",
  status: "ALLOCATED",
  shipping_cost: "30.00",
  backordered_quantity: "0",
  shipped_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  notes: null,
  quotation_number: "QT-2026-0007",
  customer_id: "2",
  customer_name: "Titan Industries",
  grand_total: "1190.0000",
};

const allocRow = {
  id: "1",
  quotation_line_id: "1",
  product_id: "1",
  product_name: "Enterprise Platform",
  warehouse_id: "1",
  warehouse_name: "Mumbai Main",
  warehouse_code: "MUM-01",
  quantity: 3,
  unit_shipping_cost: "5.00",
};

describe("Warehouses routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/v1/warehouses requires authentication", async () => {
    const res = await request(app).get("/api/v1/warehouses");
    expect(res.status).toBe(401);
  });

  it("GET /api/v1/warehouses restricts warehouse mutations to permitted roles", async () => {
    const res = await request(app)
      .get("/api/v1/warehouses")
      .set("Authorization", `Bearer ${repToken}`);
    expect(res.status).toBe(403);
  });

  it("GET /api/v1/warehouses lists warehouses with pagination", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(oneRow([{ count: "1" }]))
      .mockResolvedValueOnce(oneRow([warehouseRow]));

    const res = await request(app)
      .get("/api/v1/warehouses")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: 1, base_shipping_cost: 5 });
    expect(res.body.meta).toMatchObject({ page: 1, total: 1 });
  });

  it("POST /api/v1/warehouses creates a warehouse (admin only)", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(oneRow([])) // code conflict check
      .mockResolvedValueOnce(oneRow([{ ...warehouseRow, id: "3" }])) // insert
      .mockResolvedValueOnce(oneRow([])); // audit

    const res = await request(app)
      .post("/api/v1/warehouses")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Delhi Hub", code: "DEL-01", base_shipping_cost: 7 });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(3);
  });

  it("POST /api/v1/warehouses rejects non-admin", async () => {
    const res = await request(app)
      .post("/api/v1/warehouses")
      .set("Authorization", `Bearer ${warehouseToken}`)
      .send({ name: "Delhi Hub", code: "DEL-01" });
    expect(res.status).toBe(403);
  });

  it("GET /api/v1/warehouses/:id/inventory lists stock", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(oneRow([{ id: "1" }])) // warehouse exists
      .mockResolvedValueOnce(oneRow([{ count: "1" }]))
      .mockResolvedValueOnce(oneRow([inventoryRow]));

    const res = await request(app)
      .get("/api/v1/warehouses/1/inventory")
      .set("Authorization", `Bearer ${warehouseToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ quantity_on_hand: 12, product_id: 1 });
    // Only inventory-tracked (physical) products may be listed per region.
    expect(String(vi.mocked(db.query).mock.calls[2][0])).toContain("track_inventory = true");
  });

  it("POST /api/v1/warehouses/:id/inventory rejects software/digital products", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(oneRow([{ name: "Mumbai Main" }])) // warehouse exists
      .mockResolvedValueOnce(oneRow([{ name: "RevSync Enterprise Platform", track_inventory: false }])); // product is untracked

    const res = await request(app)
      .post("/api/v1/warehouses/1/inventory")
      .set("Authorization", `Bearer ${warehouseToken}`)
      .send({ product_id: 1, quantity_on_hand: 12, reorder_threshold: 3 });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain("not tracked in inventory");
    // The upsert must never run for an untracked product.
    const upserts = vi.mocked(db.query).mock.calls.filter((c) => String(c[0]).includes("INSERT INTO inventory_items"));
    expect(upserts).toHaveLength(0);
  });

  it("POST /api/v1/warehouses/:id/inventory upserts stock level", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(oneRow([{ name: "Mumbai Main" }])) // warehouse exists
      .mockResolvedValueOnce(oneRow([{ name: "Enterprise Platform", track_inventory: true }])) // product exists
      .mockResolvedValueOnce(oneRow([])) // before (no existing row)
      .mockResolvedValueOnce(oneRow([{ ...inventoryRow, id: "9" }])) // upsert
      .mockResolvedValueOnce(oneRow([])); // audit

    const res = await request(app)
      .post("/api/v1/warehouses/1/inventory")
      .set("Authorization", `Bearer ${warehouseToken}`)
      .send({ product_id: 1, quantity_on_hand: 12, reorder_threshold: 3 });

    expect(res.status).toBe(201);
    expect(res.body.data.quantity_on_hand).toBe(12);
  });
});

describe("Fulfillment routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/v1/fulfillment lists orders", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(oneRow([{ count: "1" }]))
      .mockResolvedValueOnce(oneRow([{ ...orderRow, backordered_quantity: "0" }]));

    const res = await request(app)
      .get("/api/v1/fulfillment")
      .set("Authorization", `Bearer ${warehouseToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ id: 1, quotation_number: "QT-2026-0007" });
  });

  it("POST /api/v1/fulfillment requires a CONFIRMED quotation", async () => {
    vi.mocked(db.query).mockResolvedValueOnce(oneRow([{ id: "7", status: "DRAFT" }]));

    const res = await request(app)
      .post("/api/v1/fulfillment")
      .set("Authorization", `Bearer ${warehouseToken}`)
      .send({ quotation_id: 7 });

    expect(res.status).toBe(422);
  });

  it("POST /api/v1/fulfillment auto-allocates and creates a fully covered order", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(oneRow([{ id: "7", status: "CONFIRMED" }])) // quote
      .mockResolvedValueOnce(oneRow([])) // existing order
      .mockResolvedValueOnce(oneRow([
        { quotation_line_id: "1", product_id: "1", quantity: "3", track_inventory: true },
        { quotation_line_id: "2", product_id: "2", quantity: "2", track_inventory: true },
      ])) // lines
      .mockResolvedValueOnce(oneRow([
        { id: "1", base_shipping_cost: "5.00" },
        { id: "2", base_shipping_cost: "10.00" },
      ])) // warehouses
      .mockResolvedValueOnce(oneRow([
        { product_id: "1", warehouse_id: "1", quantity_on_hand: 5 },
        { product_id: "1", warehouse_id: "2", quantity_on_hand: 2 },
        { product_id: "2", warehouse_id: "1", quantity_on_hand: 1 },
        { product_id: "2", warehouse_id: "2", quantity_on_hand: 10 },
      ])) // inventory
      .mockResolvedValueOnce(oneRow([])) // shipment counts
      .mockResolvedValueOnce(oneRow([{ id: "1", status: "ALLOCATED", shipping_cost: "30.00", backordered_quantity: 0 }])) // insert order
      .mockResolvedValueOnce(oneRow([])) // alloc insert 1 (p1 x W1)
      .mockResolvedValueOnce(oneRow([])) // alloc insert 2 (p2 x W1)
      .mockResolvedValueOnce(oneRow([])) // alloc insert 3 (p2 x W2)
      .mockResolvedValueOnce(oneRow([])) // audit
      .mockResolvedValueOnce(oneRow([orderRow])) // loadOrder header
      .mockResolvedValueOnce(oneRow([allocRow, allocRow, allocRow])); // loadOrder allocations

    const res = await request(app)
      .post("/api/v1/fulfillment")
      .set("Authorization", `Bearer ${warehouseToken}`)
      .send({ quotation_id: 7 });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("ALLOCATED");
    expect(res.body.data.allocations).toHaveLength(3);
    expect(res.body.data.shipping_cost).toBe(30);
  });

  it("POST /api/v1/fulfillment records backorders when stock is short", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(oneRow([{ id: "7", status: "CONFIRMED" }])) // quote
      .mockResolvedValueOnce(oneRow([])) // existing order
      .mockResolvedValueOnce(oneRow([
        { quotation_line_id: "1", product_id: "1", quantity: "10", track_inventory: true },
      ])) // lines
      .mockResolvedValueOnce(oneRow([
        { id: "1", base_shipping_cost: "5.00" },
        { id: "2", base_shipping_cost: "10.00" },
      ])) // warehouses
      .mockResolvedValueOnce(oneRow([
        { product_id: "1", warehouse_id: "1", quantity_on_hand: 5 },
        { product_id: "1", warehouse_id: "2", quantity_on_hand: 2 },
      ])) // inventory
      .mockResolvedValueOnce(oneRow([])) // shipment counts
      .mockResolvedValueOnce(oneRow([{ id: "1", status: "PARTIAL", shipping_cost: "35.00", backordered_quantity: 3 }])) // insert order
      .mockResolvedValueOnce(oneRow([])) // alloc insert 1 (W1 x5)
      .mockResolvedValueOnce(oneRow([])) // alloc insert 2 (W2 x2)
      .mockResolvedValueOnce(oneRow([])) // audit
      .mockResolvedValueOnce(oneRow([{ ...orderRow, status: "PARTIAL", backordered_quantity: 3 }])) // loadOrder header
      .mockResolvedValueOnce(oneRow([allocRow, allocRow])); // loadOrder allocations

    const res = await request(app)
      .post("/api/v1/fulfillment")
      .set("Authorization", `Bearer ${warehouseToken}`)
      .send({ quotation_id: 7 });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("PARTIAL");
    expect(res.body.data.backordered_quantity).toBe(3);
  });

  it("POST /api/v1/fulfillment never allocates or backorders digital (non-inventory) products", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(oneRow([{ id: "7", status: "CONFIRMED" }])) // quote
      .mockResolvedValueOnce(oneRow([])) // existing order
      .mockResolvedValueOnce(oneRow([
        { quotation_line_id: "1", product_id: "1", quantity: "3", track_inventory: false },
      ])) // lines (software — not tracked)
      .mockResolvedValueOnce(oneRow([{ id: "1", status: "ALLOCATED", shipping_cost: "0.00", backordered_quantity: 0 }])) // insert order
      .mockResolvedValueOnce(oneRow([])) // audit
      .mockResolvedValueOnce(oneRow([{ ...orderRow, status: "ALLOCATED", backordered_quantity: "0", shipping_cost: "0.00" }])) // loadOrder header
      .mockResolvedValueOnce(oneRow([])); // loadOrder allocations

    const res = await request(app)
      .post("/api/v1/fulfillment")
      .set("Authorization", `Bearer ${warehouseToken}`)
      .send({ quotation_id: 7 });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("ALLOCATED");
    expect(res.body.data.allocations).toHaveLength(0);
    expect(res.body.data.backordered_quantity).toBe(0);
    expect(res.body.data.shipping_cost).toBe(0);
    // A purely digital order needs no warehouse/stock lookups at all.
    const warehouseQueries = vi.mocked(db.query).mock.calls.filter((c) => String(c[0]).includes("FROM warehouses"));
    expect(warehouseQueries).toHaveLength(0);
  });

  it("POST /api/v1/fulfillment/:id/override replaces allocations manually", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(oneRow([{ id: "1", status: "ALLOCATED", quotation_id: "7" }])) // order
      .mockResolvedValueOnce(oneRow([{ product_id: "1", requested: 5 }])) // requested totals
      .mockResolvedValueOnce(oneRow([{ id: "1", product_id: "1", warehouse_id: "1", quantity: 2, quotation_line_id: "1" }])) // current allocations
      .mockResolvedValueOnce(oneRow([{ id: "2" }])) // active warehouses
      .mockResolvedValueOnce(oneRow([{ id: "1", product_id: "1", track_inventory: true }])) // line id by product
      .mockResolvedValueOnce(oneRow([])) // insert new allocation (p1 x W2)
      .mockResolvedValueOnce(oneRow([{ allocated: 4, cnt: 2 }])) // recalc
      .mockResolvedValueOnce(oneRow([{ total: "15.00" }])) // shipping total
      .mockResolvedValueOnce(oneRow([])) // update order
      .mockResolvedValueOnce(oneRow([])) // audit
      .mockResolvedValueOnce(oneRow([{ ...orderRow, status: "PARTIAL", backordered_quantity: 1 }])) // loadOrder header
      .mockResolvedValueOnce(oneRow([allocRow, allocRow])); // loadOrder allocations

    const res = await request(app)
      .post("/api/v1/fulfillment/1/override")
      .set("Authorization", `Bearer ${warehouseToken}`)
      .send({ allocations: [{ product_id: 1, warehouse_id: 2, quantity: 2 }] });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("PARTIAL");
    expect(res.body.data.backordered_quantity).toBe(1);
  });

  it("POST /api/v1/fulfillment/:id/override supports reallocation between warehouses", async () => {
    // Current: product 1 allocated MUM(1) + BLR(2) = 3 of 3 requested.
    // Desired: move everything off BLR (0) onto MUM (3) in a single override call.
    vi.mocked(db.query)
      .mockResolvedValueOnce(oneRow([{ id: "1", status: "ALLOCATED", quotation_id: "7" }])) // order
      .mockResolvedValueOnce(oneRow([{ product_id: "1", requested: 3 }])) // requested totals
      .mockResolvedValueOnce(oneRow([
        { id: "1", product_id: "1", warehouse_id: "1", quantity: 1, quotation_line_id: "1" },
        { id: "2", product_id: "1", warehouse_id: "3", quantity: 2, quotation_line_id: "1" },
      ])) // current allocations
      .mockResolvedValueOnce(oneRow([{ id: "1" }, { id: "3" }])) // active warehouses
      .mockResolvedValueOnce(oneRow([{ id: "1", product_id: "1", track_inventory: true }])) // line id by product
      .mockResolvedValueOnce(oneRow([])) // update MUM -> 3
      .mockResolvedValueOnce(oneRow([])) // delete BLR
      .mockResolvedValueOnce(oneRow([{ allocated: 3, cnt: 1 }])) // recalc
      .mockResolvedValueOnce(oneRow([{ total: "15.00" }])) // shipping total
      .mockResolvedValueOnce(oneRow([])) // update order
      .mockResolvedValueOnce(oneRow([])) // audit
      .mockResolvedValueOnce(oneRow([{ ...orderRow, status: "ALLOCATED", backordered_quantity: 0 }])) // loadOrder header
      .mockResolvedValueOnce(oneRow([allocRow])); // loadOrder allocations

    const res = await request(app)
      .post("/api/v1/fulfillment/1/override")
      .set("Authorization", `Bearer ${warehouseToken}`)
      .send({
        allocations: [
          { product_id: 1, warehouse_id: 1, quantity: 3 },
          { product_id: 1, warehouse_id: 3, quantity: 0 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ALLOCATED");
  });

  it("POST /api/v1/fulfillment/:id/override rejects over-allocation", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(oneRow([{ id: "1", status: "ALLOCATED", quotation_id: "7" }])) // order
      .mockResolvedValueOnce(oneRow([{ product_id: "1", requested: 5 }])) // requested totals
      .mockResolvedValueOnce(oneRow([{ id: "1", product_id: "1", warehouse_id: "1", quantity: 5, quotation_line_id: "1" }])) // current allocations
      .mockResolvedValueOnce(oneRow([{ id: "2" }])) // active warehouses
      .mockResolvedValueOnce(oneRow([{ id: "1", product_id: "1", track_inventory: true }])); // line id by product

    const res = await request(app)
      .post("/api/v1/fulfillment/1/override")
      .set("Authorization", `Bearer ${warehouseToken}`)
      .send({ allocations: [{ product_id: 1, warehouse_id: 2, quantity: 2 }] });

    expect(res.status).toBe(422);
  });

  it("POST /api/v1/fulfillment/:id/ship deducts inventory and marks shipped", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(oneRow([{ id: "1", status: "ALLOCATED" }])) // order
      .mockResolvedValueOnce(oneRow([{ warehouse_id: "1", product_id: "1", quantity: 3 }])) // allocations
      .mockResolvedValueOnce(oneRow([{ id: "9" }])) // inventory decrement
      .mockResolvedValueOnce(oneRow([{ id: "1" }])) // update order -> SHIPPED
      .mockResolvedValueOnce(oneRow([])) // audit
      .mockResolvedValueOnce(oneRow([{ ...orderRow, status: "SHIPPED" }])) // loadOrder header
      .mockResolvedValueOnce(oneRow([allocRow])); // loadOrder allocations

    const res = await request(app)
      .post("/api/v1/fulfillment/1/ship")
      .set("Authorization", `Bearer ${warehouseToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("SHIPPED");
  });

  it("POST /api/v1/fulfillment/:id/ship refuses when stock is insufficient", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(oneRow([{ id: "1", status: "ALLOCATED" }])) // order
      .mockResolvedValueOnce(oneRow([{ warehouse_id: "1", product_id: "1", quantity: 5 }])) // allocations
      .mockResolvedValueOnce(oneRow([])); // inventory decrement returns no rows

    const res = await request(app)
      .post("/api/v1/fulfillment/1/ship")
      .set("Authorization", `Bearer ${warehouseToken}`);

    expect(res.status).toBe(409);
  });

  it("POST /api/v1/fulfillment/:id/cancel marks the order cancelled", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(oneRow([{ id: "1", status: "PARTIAL" }])) // order
      .mockResolvedValueOnce(oneRow([{ id: "1" }])) // update order
      .mockResolvedValueOnce(oneRow([])) // audit
      .mockResolvedValueOnce(oneRow([{ ...orderRow, status: "CANCELLED" }])) // loadOrder header
      .mockResolvedValueOnce(oneRow([allocRow])); // loadOrder allocations

    const res = await request(app)
      .post("/api/v1/fulfillment/1/cancel")
      .set("Authorization", `Bearer ${warehouseToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CANCELLED");
  });

  it("blocks a sales rep from creating fulfillment orders", async () => {
    const res = await request(app)
      .post("/api/v1/fulfillment")
      .set("Authorization", `Bearer ${repToken}`)
      .send({ quotation_id: 7 });
    expect(res.status).toBe(403);
  });
});