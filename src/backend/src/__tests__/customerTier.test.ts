import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import express from "express";
import request from "supertest";
import { customersRouter } from "../modules/customers/customers.routes.js";
import { errorHandler } from "../middleware/errorHandler.js";
import * as db from "../database/pool.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-min-16-chars";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/customers", customersRouter);
  app.use(errorHandler);
  return app;
}

const app = createApp();

function token(roleId: number, userId: number = 1) {
  return jwt.sign({ userId, roleId, email: "test@test.com" }, JWT_SECRET, { expiresIn: "1h" });
}

const admin = token(5);
const rep = token(1);
const manager = token(2);
const warehouse = token(4);

const customerRow = {
  id: 1, name: "Acme Corp", email: "acme@test.com", company: "Acme Inc",
  phone: "+1234567890", status: "ACTIVE", currency_code: "USD",
  tier_id: 2, tier_name: "Silver",
  customer_type: "ENTERPRISE", expected_po_value: "2500000",
  payment_terms: "NET_30", upfront_payment_pct: "100",
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
};

const rulesRows = [
  { id: 1, name: "Enterprise high-value advance", target_tier: "GOLD", customer_type: "ENTERPRISE", min_expected_po_value: "2000000", min_upfront_payment_pct: "50", payment_terms: ["NET_30"], is_active: true },
  { id: 2, name: "Business mid-value", target_tier: "SILVER", customer_type: "BUSINESS", min_expected_po_value: "500000", min_upfront_payment_pct: null, payment_terms: [], is_active: true },
  { id: 3, name: "Default", target_tier: "BRONZE", customer_type: null, min_expected_po_value: null, min_upfront_payment_pct: null, payment_terms: [], is_active: true },
];

function mockResult(rows: unknown[], rowCount = rows.length) {
  return { rows, rowCount, command: "", oid: 0, fields: [] } as any;
}

describe("Customer Tier workflow endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /:id/tier/evaluate", () => {
    it("requires auth", async () => {
      const res = await request(app).post("/api/v1/customers/1/tier/evaluate");
      expect(res.status).toBe(401);
    });

    it("returns the recommended tier with reasons for a Sales Rep", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(mockResult([customerRow]))      // customer
        .mockResolvedValueOnce(mockResult(rulesRows));         // tier rules

      const res = await request(app)
        .post("/api/v1/customers/1/tier/evaluate")
        .set("Authorization", `Bearer ${rep}`);

      expect(res.status).toBe(200);
      expect(res.body.data.recommended_tier).toBe("GOLD");
      expect(res.body.data.matched_rules.length).toBeGreaterThan(0);
    });

    it("returns 404 for a non-existent customer", async () => {
      vi.mocked(db.query).mockResolvedValueOnce(mockResult([]));
      const res = await request(app)
        .post("/api/v1/customers/999/tier/evaluate")
        .set("Authorization", `Bearer ${rep}`);
      expect(res.status).toBe(404);
    });
  });

  describe("POST /:id/tier/confirm", () => {
    it("confirms the recommended tier for a Sales Rep", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(mockResult([customerRow]))     // customer
        .mockResolvedValueOnce(mockResult(rulesRows))         // rules
        .mockResolvedValueOnce(mockResult([{ id: 3 }]))       // customer_tiers lookup (GOLD=3)
        .mockResolvedValueOnce(mockResult([{ id: 1 }]))       // UPDATE customers RETURNING
        .mockResolvedValueOnce(mockResult([{ id: 1 }]))       // INSERT evaluation
        .mockResolvedValueOnce(mockResult([{ id: 1 }]));      // audit log

      const res = await request(app)
        .post("/api/v1/customers/1/tier/confirm")
        .set("Authorization", `Bearer ${rep}`);

      expect(res.status).toBe(200);
      expect(res.body.data.resolved_tier).toBe("GOLD");
      expect(res.body.data.status).toBe("CONFIRMED");
    });

    it("rejects a Warehouse Manager", async () => {
      const res = await request(app)
        .post("/api/v1/customers/1/tier/confirm")
        .set("Authorization", `Bearer ${warehouse}`);
      expect(res.status).toBe(403);
    });
  });

  describe("POST /:id/tier/override", () => {
    it("allows a manager override to a different tier with audit", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(mockResult([customerRow]))      // customer
        .mockResolvedValueOnce(mockResult([{ id: 1 }]))       // tier lookup (BRONZE=1)
        .mockResolvedValueOnce(mockResult(rulesRows))         // tier rules
        .mockResolvedValueOnce(mockResult([{ id: 1 }]))       // UPDATE customers
        .mockResolvedValueOnce(mockResult([{ id: 1 }]))       // INSERT evaluation
        .mockResolvedValueOnce(mockResult([{ id: 1 }]))       // audit log
        .mockResolvedValueOnce(mockResult([{ ...customerRow, tier_name: "Bronze", tier_id: 1 }])); // re-fetch

      const res = await request(app)
        .post("/api/v1/customers/1/tier/override")
        .set("Authorization", `Bearer ${manager}`)
        .send({ requested_tier: "BRONZE", reason: "Volume too low for Silver" });

      expect(res.status).toBe(200);
      expect(res.body.data.resolved_tier).toBe("BRONZE");
      expect(res.body.data.status).toBe("OVERRIDDEN");
    });

    it("rejects an override without a reason", async () => {
      const res = await request(app)
        .post("/api/v1/customers/1/tier/override")
        .set("Authorization", `Bearer ${manager}`)
        .send({ requested_tier: "GOLD" });
      expect(res.status).toBe(400);
    });

    it("rejects a Sales Rep override (needs manager path)", async () => {
      const res = await request(app)
        .post("/api/v1/customers/1/tier/override")
        .set("Authorization", `Bearer ${rep}`)
        .send({ requested_tier: "GOLD", reason: "test" });
      expect(res.status).toBe(403);
    });
  });

  describe("GET /:id/tier/evaluations", () => {
    it("returns the evaluation history", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(mockResult([customerRow]))     // customer
        .mockResolvedValueOnce(mockResult([
          { id: 1, status: "CONFIRMED", recommended_tier: "GOLD", resolved_tier: "GOLD", input_snapshot: {}, matched_rules: [], action_by: 1, action_at: new Date().toISOString(), reason: "ok" },
        ]));

      const res = await request(app)
        .get("/api/v1/customers/1/tier/evaluations")
        .set("Authorization", `Bearer ${manager}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });
});
