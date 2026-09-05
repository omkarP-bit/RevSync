import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import express from "express";
import request from "supertest";
import { quotationsRouter } from "../modules/quotations/quotations.routes.ts";
import { errorHandler } from "../middleware/errorHandler.js";
import * as db from "../database/pool.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-min-16-chars";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/quotations", quotationsRouter);
  app.use(errorHandler);
  return app;
}

const app = createApp();

function repToken() {
  return jwt.sign({ userId: 3, roleId: 1, email: "rep@test.com" }, JWT_SECRET, { expiresIn: "1h" });
}

const mockQuote = {
  id: 1,
  quotation_number: "QT-2026-0001",
  public_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  customer_id: 1,
  customer_name: "Acme Corp",
  customer_tier_id: 1,
  tier_name: "Bronze",
  sales_rep_id: 3,
  sales_rep_name: "Alex Salesrep",
  currency_code: "USD",
  status: "DRAFT",
  subtotal: "1000.0000",
  discount_total: "100.0000",
  tax_rate_pct: "10.00",
  tax_total: "90.0000",
  grand_total: "990.0000",
  total_cost: "600.0000",
  margin_amount: "300.0000",
  margin_pct: "33.33",
  total_overage: "0.0000",
  risk_level: "LOW",
  notes: "Test quote",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const mockLine = {
  id: 10,
  quotation_id: 1,
  product_id: 5,
  product_name: "Software License",
  product_sku: "SW-001",
  product_variant_id: null,
  variant_name: null,
  description: "Standard pack",
  quantity: 10,
  unit_price: "100.0000",
  unit_cost: "60.0000",
  applied_discount_pct: "10.00",
  discount_amount: "100.0000",
  line_subtotal: "1000.0000",
  line_total: "900.0000",
  line_cost: "600.0000",
  line_margin: "300.0000",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("Quotations routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/v1/quotations", () => {
    it("should require authentication", async () => {
      const res = await request(app).get("/api/v1/quotations");
      expect(res.status).toBe(401);
    });

    it("should return paginated quotations for Sales Rep", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ count: "1" }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [mockQuote], rowCount: 1, command: "", oid: 0, fields: [] });

      const res = await request(app)
        .get("/api/v1/quotations")
        .set("Authorization", `Bearer ${repToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0].quotation_number).toBe("QT-2026-0001");
      expect(res.body.data[0].grand_total).toBe(990);
    });
  });

  describe("POST /api/v1/quotations", () => {
    it("should create a new quote and generate quotation_number", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ id: 1, currency_code: "USD" }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: "0" }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [mockQuote], rowCount: 1, command: "", oid: 0, fields: [] });

      const res = await request(app)
        .post("/api/v1/quotations")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({
          customer_id: 1,
          tax_rate_pct: 10.0,
          notes: "Initial quote",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.quotation_number).toBe("QT-2026-0001");
    });
  });

  describe("GET /api/v1/quotations/:id", () => {
    it("should return detailed quote with lines", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [mockQuote], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [mockLine], rowCount: 1, command: "", oid: 0, fields: [] });

      const res = await request(app)
        .get("/api/v1/quotations/1")
        .set("Authorization", `Bearer ${repToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.lines).toHaveLength(1);
      expect(res.body.data.lines[0].line_margin).toBe(300);
    });
  });
});
