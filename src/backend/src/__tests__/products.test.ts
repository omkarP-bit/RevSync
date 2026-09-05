import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import express from "express";
import request from "supertest";
import { productsRouter } from "../modules/products/products.routes.ts";
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
});
