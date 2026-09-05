import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import express from "express";
import request from "supertest";
import { discountsRouter } from "../modules/discounts/discounts.routes.js";
import { errorHandler } from "../middleware/errorHandler.js";
import * as db from "../database/pool.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-min-16-chars";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/discounts", discountsRouter);
  app.use(errorHandler);
  return app;
}

const app = createApp();

function token(roleId: number) {
  return jwt.sign({ userId: 3, roleId, email: "u@test.com" }, JWT_SECRET, { expiresIn: "1h" });
}

const adminToken = token(5);
const repToken = token(1);

const ruleRow = {
  id: "1",
  customer_tier_id: "3",
  tier_name: "Gold",
  category_id: "1",
  category_name: "Software Licenses",
  max_discount_pct: "10.00",
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const emptyResult = { rows: [], rowCount: 0, command: "", oid: 0, fields: [] };
const oneRow = (rows: any[]) => ({ rows, rowCount: rows.length, command: "", oid: 0, fields: [] });

describe("Discounts routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/v1/discounts/rules", () => {
    it("requires authentication", async () => {
      const res = await request(app).get("/api/v1/discounts/rules");
      expect(res.status).toBe(401);
    });

    it("restricts listing to Admin and Sales Manager", async () => {
      const res = await request(app)
        .get("/api/v1/discounts/rules")
        .set("Authorization", `Bearer ${repToken}`);
      expect(res.status).toBe(403);
    });

    it("returns paginated discount rules for Admin", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(oneRow([{ count: "1" }]))
        .mockResolvedValueOnce(oneRow([ruleRow]));

      const res = await request(app)
        .get("/api/v1/discounts/rules")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(1);
      expect(res.body.data[0].max_discount_pct).toBe(10);
      expect(res.body.meta.total).toBe(1);
    });
  });

  describe("POST /api/v1/discounts/rules", () => {
    it("creates a discount rule as Admin", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(oneRow([{ id: 3 }])) // tier exists
        .mockResolvedValueOnce(oneRow([{ id: 1 }])) // category exists
        .mockResolvedValueOnce(emptyResult) // no active conflict
        .mockResolvedValueOnce(oneRow([ruleRow]));

      const res = await request(app)
        .post("/api/v1/discounts/rules")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          customer_tier_id: 3,
          category_id: 1,
          max_discount_pct: 10,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.max_discount_pct).toBe(10);
    });

    it("rejects a conflicting active rule with 409", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(oneRow([{ id: 3 }]))
        .mockResolvedValueOnce(oneRow([{ id: 1 }]))
        .mockResolvedValueOnce(oneRow([{ id: 99 }])); // conflict exists

      const res = await request(app)
        .post("/api/v1/discounts/rules")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          customer_tier_id: 3,
          category_id: 1,
          max_discount_pct: 15,
        });

      expect(res.status).toBe(409);
    });

    it("restricts creation to Admin", async () => {
      const res = await request(app)
        .post("/api/v1/discounts/rules")
        .set("Authorization", `Bearer ${repToken}`)
        .send({ customer_tier_id: 3, category_id: 1, max_discount_pct: 10 });
      expect(res.status).toBe(403);
    });
  });

  describe("PATCH /api/v1/discounts/rules/:id", () => {
    it("updates an existing rule as Admin", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(oneRow([ruleRow])) // before
        .mockResolvedValueOnce(oneRow([{ ...ruleRow, max_discount_pct: "15.00" }]));

      const res = await request(app)
        .patch("/api/v1/discounts/rules/1")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ max_discount_pct: 15 });

      expect(res.status).toBe(200);
      expect(res.body.data.max_discount_pct).toBe(15);
    });

    it("returns 404 when the rule does not exist", async () => {
      vi.mocked(db.query).mockResolvedValueOnce(emptyResult);

      const res = await request(app)
        .patch("/api/v1/discounts/rules/999")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ max_discount_pct: 15 });

      expect(res.status).toBe(404);
    });
  });
});