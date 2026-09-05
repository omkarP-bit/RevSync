import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import express from "express";
import request from "supertest";
import { productsRouter } from "../modules/products/products.routes.js";
import { errorHandler } from "../middleware/errorHandler.js";
import * as db from "../database/pool.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-min-16-chars";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/products", productsRouter);
  app.use(errorHandler);
  return app;
}

const app = createApp();

function adminToken() {
  return jwt.sign({ userId: 1, roleId: 5, email: "admin@test.com" }, JWT_SECRET, { expiresIn: "1h" });
}

function repToken() {
  return jwt.sign({ userId: 2, roleId: 1, email: "rep@test.com" }, JWT_SECRET, { expiresIn: "1h" });
}

const mockProduct = {
  id: 1,
  sku: "PROD-001",
  name: "Enterprise Software",
  description: "Core license",
  category_id: 1,
  category_name: "Software Licenses",
  product_type: "RECURRING",
  base_cost: "1000.0000",
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("Products routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/v1/products", () => {
    it("should require authentication", async () => {
      const res = await request(app).get("/api/v1/products");
      expect(res.status).toBe(401);
    });

    it("should return base_cost for Admin user", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ count: "1" }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [mockProduct], rowCount: 1, command: "", oid: 0, fields: [] });

      const res = await request(app)
        .get("/api/v1/products")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0].base_cost).toBe(1000);
    });

    it("should strip base_cost for Sales Rep user", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ count: "1" }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [mockProduct], rowCount: 1, command: "", oid: 0, fields: [] });

      const res = await request(app)
        .get("/api/v1/products")
        .set("Authorization", `Bearer ${repToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0].base_cost).toBeUndefined();
    });
  });

  describe("POST /api/v1/products", () => {
    it("should allow Admin to create a product", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ ...mockProduct, id: 2, sku: "PROD-002" }],
        rowCount: 1,
        command: "",
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .post("/api/v1/products")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({
          sku: "PROD-002",
          name: "Cloud Hosting",
          category_id: 1,
          product_type: "RECURRING",
          base_cost: 500,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.sku).toBe("PROD-002");
    });

    it("should forbid Sales Rep from creating a product", async () => {
      const res = await request(app)
        .post("/api/v1/products")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({
          sku: "PROD-002",
          name: "Forbidden Product",
          category_id: 1,
          base_cost: 100,
        });

      expect(res.status).toBe(403);
    });
  });

  describe("PATCH /api/v1/products/:id/variants/:variantId", () => {
    it("should allow Admin to update a variant", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 1, product_id: 1, sku: "PROD-001-V1", name: "Premium Pack", attributes: { tier: "premium" } }],
        rowCount: 1,
        command: "",
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .patch("/api/v1/products/1/variants/1")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ name: "Premium Pack", attributes: { tier: "premium" } });

      expect(res.status).toBe(200);
      expect(res.body.data.attributes.tier).toBe("premium");
      expect(res.body.data.name).toBe("Premium Pack");
    });

    it("should reject empty patch body", async () => {
      const res = await request(app)
        .patch("/api/v1/products/1/variants/1")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it("should forbid Sales Rep from updating a variant", async () => {
      const res = await request(app)
        .patch("/api/v1/products/1/variants/1")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ name: "X" });

      expect(res.status).toBe(403);
    });
  });

  describe("DELETE /api/v1/products/:id/variants/:variantId", () => {
    it("should allow Admin to delete a variant", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 1 }],
        rowCount: 1,
        command: "",
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .delete("/api/v1/products/1/variants/1")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBe(true);
    });

    it("should return 404 for a non-existent variant", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: "",
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .delete("/api/v1/products/1/variants/999")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/v1/products/inventory", () => {
    it("should require authentication", async () => {
      const res = await request(app).get("/api/v1/products/inventory");
      expect(res.status).toBe(401);
    });

    it("should reject a Sales Rep (not stock reader)", async () => {
      const res = await request(app)
        .get("/api/v1/products/inventory")
        .set("Authorization", `Bearer ${repToken()}`);
      expect(res.status).toBe(403);
    });

    it("should return product-by-warehouse inventory locations for Admin", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            id: "1",
            product_id: "1",
            product_name: "RevSync Enterprise Platform",
            sku: "SW-ENT-001",
            warehouse_id: "1",
            warehouse_name: "Mumbai Main",
            warehouse_code: "MUM",
            quantity_on_hand: "24",
            reorder_threshold: "5",
            updated_at: new Date().toISOString(),
          },
          {
            id: "2",
            product_id: "1",
            product_name: "RevSync Enterprise Platform",
            sku: "SW-ENT-001",
            warehouse_id: "2",
            warehouse_name: "Delhi NCR",
            warehouse_code: "DEL",
            quantity_on_hand: "15",
            reorder_threshold: "5",
            updated_at: new Date().toISOString(),
          },
        ],
        rowCount: 2,
        command: "",
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .get("/api/v1/products/inventory")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.total).toBe(2);
      expect(res.body.data[0]).toMatchObject({
        product_id: 1,
        product_name: "RevSync Enterprise Platform",
        warehouse_name: "Mumbai Main",
        warehouse_code: "MUM",
        quantity_on_hand: 24,
        reorder_threshold: 5,
      });
      expect(res.body.data[0].quantity_on_hand).toBe(24);
    });
  });
});
