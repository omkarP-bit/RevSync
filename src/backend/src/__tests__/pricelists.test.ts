import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import express from "express";
import request from "supertest";
import { pricingRouter } from "../modules/pricing/pricing.routes.ts";
import { errorHandler } from "../middleware/errorHandler.js";
import * as db from "../database/pool.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-min-16-chars";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/pricelists", pricingRouter);
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

const mockPriceList = {
  id: 1,
  name: "Gold Tier - USD",
  customer_tier_id: 3,
  tier_name: "Gold",
  currency_code: "USD",
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("Price lists routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/v1/pricelists", () => {
    it("should return paginated price lists for authenticated users", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ count: "1" }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [mockPriceList], rowCount: 1, command: "", oid: 0, fields: [] });

      const res = await request(app)
        .get("/api/v1/pricelists")
        .set("Authorization", `Bearer ${repToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0].name).toBe("Gold Tier - USD");
      expect(res.body.meta.total).toBe(1);
    });
  });

  describe("POST /api/v1/pricelists", () => {
    it("should allow Admin to create a price list", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockPriceList],
        rowCount: 1,
        command: "",
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .post("/api/v1/pricelists")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({
          name: "Gold Tier - USD",
          customer_tier_id: 3,
          currency_code: "USD",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe("Gold Tier - USD");
    });
  });

  describe("POST /api/v1/pricelists/:id/items", () => {
    it("should allow Admin to set item unit price", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 10,
              price_list_id: 1,
              product_id: 5,
              unit_price: "1500.0000",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
          rowCount: 1,
          command: "",
          oid: 0,
          fields: [],
        });

      const res = await request(app)
        .post("/api/v1/pricelists/1/items")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({
          product_id: 5,
          unit_price: 1500,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.unit_price).toBe(1500);
    });
  });
});
