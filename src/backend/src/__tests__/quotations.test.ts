import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import express from "express";
import request from "supertest";
import { quotationsRouter } from "../modules/quotations/quotations.routes.js";
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

const qr = (rows: any[]) => ({ rows, rowCount: rows.length, command: "", oid: 0, fields: [] });

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
  category_id: 1,
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

// Row shapes returned by fetchQuoteContext (quotations x customers join).
const ctxRow = (overrides: Partial<typeof mockQuote> = {}) => ({
  id: 1,
  customer_id: 1,
  sales_rep_id: 3,
  currency_code: "USD",
  tax_rate_pct: "10.00",
  status: "DRAFT",
  customer_tier_id: 1,
  ...overrides,
});

// Phase 4 rule seeds aligned with the smoke-test plan.
const discountRule = { id: 1, customer_tier_id: 1, category_id: 1, max_discount_pct: "10.00", is_active: true };
const mediumRule = { id: 1, risk_level: "MEDIUM", min_total_overage: "5.00", role_sequence: [2], is_active: true };
const highRule = { id: 2, risk_level: "HIGH", min_total_overage: "8.00", role_sequence: [2, 3], is_active: true };

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
        .mockResolvedValueOnce(qr([{ count: "1" }]))
        .mockResolvedValueOnce(qr([mockQuote]));

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
        .mockResolvedValueOnce(qr([{ id: 1, currency_code: "USD" }]))
        .mockResolvedValueOnce(qr([{ count: "0" }]))
        .mockResolvedValueOnce(qr([mockQuote]));

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
    it("should return detailed quote with lines and discount analysis", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([mockQuote]))
        .mockResolvedValueOnce(qr([{ ...mockLine, applied_discount_pct: "15.00" }]))
        .mockResolvedValueOnce(qr([discountRule]));

      const res = await request(app)
        .get("/api/v1/quotations/1")
        .set("Authorization", `Bearer ${repToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.lines).toHaveLength(1);
      expect(res.body.data.lines[0].line_margin).toBe(300);
      // Bronze (tier 1) x Software (cat 1) allows 10%; 15% applied -> 5 pts overage.
      expect(res.body.data.discount_analysis.lines[0].is_flagged).toBe(true);
      expect(res.body.data.discount_analysis.lines[0].line_overage).toBe(5);
      expect(res.body.data.discount_analysis.lines[0].reason).toContain("15%");
    });
  });

  describe("POST /api/v1/quotations/:id/submit", () => {
    it("approves a LOW risk quotation without creating an approval request", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([ctxRow()])) // fetchQuoteContext
        .mockResolvedValueOnce(qr([{ ...mockLine, applied_discount_pct: "0.00" }])) // lines w/ discount 0
        .mockResolvedValueOnce(qr([])) // discount rules
        .mockResolvedValueOnce(qr([])) // approval rules
        .mockResolvedValueOnce(qr([])) // line update
        .mockResolvedValueOnce(qr([{ ...mockQuote, risk_level: "LOW", total_overage: "0.0000" }])) // header update
        .mockResolvedValueOnce(qr([])) // status -> APPROVED
        .mockResolvedValueOnce(qr([{ id: 1 }])) // audit
        .mockResolvedValueOnce(qr([{ ...mockQuote, status: "APPROVED" }])); // final select

      const res = await request(app)
        .post("/api/v1/quotations/1/submit")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ notes: "Straightforward deal" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("APPROVED");
      expect(db.query).toHaveBeenCalledTimes(9);
    });

    it("routes a HIGH overage into a two-step approval request", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([ctxRow()])) // fetchQuoteContext
        .mockResolvedValueOnce(qr([{ ...mockLine, applied_discount_pct: "18.00" }])) // 18% applied
        .mockResolvedValueOnce(qr([discountRule])) // 10% max for tier 1 x cat 1 -> overage 8
        .mockResolvedValueOnce(qr([mediumRule, highRule]))
        .mockResolvedValueOnce(qr([])) // line update
        .mockResolvedValueOnce(qr([{ ...mockQuote, risk_level: "HIGH", total_overage: "8.0000" }])) // header update
        .mockResolvedValueOnce(qr([{ id: 5, quotation_id: 1, status: "PENDING_APPROVAL", risk_level: "HIGH" }])) // insert request
        .mockResolvedValueOnce(qr([])) // step 1 (Sales Manager)
        .mockResolvedValueOnce(qr([])) // step 2 (Finance)
        .mockResolvedValueOnce(qr([{ id: 1 }])) // audit
        .mockResolvedValueOnce(qr([])) // status -> PENDING_APPROVAL
        .mockResolvedValueOnce(qr([{ id: 1 }])) // audit
        .mockResolvedValueOnce(qr([{ ...mockQuote, status: "PENDING_APPROVAL", risk_level: "HIGH", total_overage: "8.0000" }])); // final select

      const res = await request(app)
        .post("/api/v1/quotations/1/submit")
        .set("Authorization", `Bearer ${repToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("PENDING_APPROVAL");
      expect(res.body.data.risk_level).toBe("HIGH");
      expect(res.body.data.total_overage).toBe(8);
    });

    it("rejects submission for a quotation that is not DRAFT/NEGOTIATION", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([ctxRow({ status: "APPROVED" })]))
        .mockResolvedValueOnce(qr([mockLine]))
        .mockResolvedValueOnce(qr([]))
        .mockResolvedValueOnce(qr([]))
        .mockResolvedValueOnce(qr([])) // line update
        .mockResolvedValueOnce(qr([{ ...mockQuote, status: "APPROVED" }])); // header update (reflects DB status)

      const res = await request(app)
        .post("/api/v1/quotations/1/submit")
        .set("Authorization", `Bearer ${repToken()}`);

      expect(res.status).toBe(422);
    });
  });

  describe("PATCH /api/v1/quotations/:id status guards", () => {
    it("blocks setting APPROVED directly via the workflow-state gate", async () => {
      vi.mocked(db.query).mockResolvedValueOnce(qr([ctxRow()]));

      const res = await request(app)
        .patch("/api/v1/quotations/1")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ status: "APPROVED" });

      expect(res.status).toBe(422);
    });

    it("blocks CONFIRMED on a quotation that is not APPROVED", async () => {
      vi.mocked(db.query).mockResolvedValueOnce(qr([ctxRow({})]));

      const res = await request(app)
        .patch("/api/v1/quotations/1")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ status: "CONFIRMED" });

      expect(res.status).toBe(422);
    });

    it("blocks CONFIRMED while an approval is still open", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([ctxRow({ status: "APPROVED" })]))
        .mockResolvedValueOnce(qr([{ id: 5 }]));

      const res = await request(app)
        .patch("/api/v1/quotations/1")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ status: "CONFIRMED" });

      expect(res.status).toBe(422);
    });
  });

  describe("POST /api/v1/quotations/:id/lines on a PENDING_APPROVAL quote", () => {
    it("cancels the open approval and re-creates it after the edit", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([{ id: 1, currency_code: "USD", customer_tier_id: 1 }])) // quote
        .mockResolvedValueOnce(qr([{ id: 6, name: "Hardware", base_cost: "50.0000" }])) // product
        .mockResolvedValueOnce(qr([])) // price list
        .mockResolvedValueOnce(qr([{ id: 11 }])) // insert line
        .mockResolvedValueOnce(qr([{ id: 1 }])) // audit LINE_ADDED
        // ---- recalculateAndPersistQuotation
        .mockResolvedValueOnce(qr([ctxRow({ status: "PENDING_APPROVAL" })])) // quote context
        .mockResolvedValueOnce(qr([
          { id: 10, product_id: 5, category_id: 1, quantity: 10, unit_price: "100.0000", unit_cost: "60.0000", applied_discount_pct: "18.00", line_subtotal: "1000.0000" },
          { id: 11, product_id: 6, category_id: 1, quantity: 2, unit_price: "65.0000", unit_cost: "50.0000", applied_discount_pct: "0.00", line_subtotal: "130.0000" },
        ])) // lines
        .mockResolvedValueOnce(qr([discountRule])) // discount rules
        .mockResolvedValueOnce(qr([mediumRule, highRule])) // approval rules
        .mockResolvedValueOnce(qr([])) // line update 10
        .mockResolvedValueOnce(qr([])) // line update 11
        .mockResolvedValueOnce(qr([{ ...mockQuote, status: "PENDING_APPROVAL", risk_level: "HIGH", total_overage: "8.0000" }])) // header update
        // ---- reopenApprovalAfterEdit (still HIGH -> cancel + re-create)
        .mockResolvedValueOnce(qr([{ id: 5 }])) // open approval
        .mockResolvedValueOnce(qr([])) // cancel request
        .mockResolvedValueOnce(qr([{ id: 1 }])) // audit CANCELLED
        .mockResolvedValueOnce(qr([{ id: 6, status: "PENDING_APPROVAL", risk_level: "HIGH" }])) // insert new request
        .mockResolvedValueOnce(qr([])) // step 1
        .mockResolvedValueOnce(qr([])) // step 2
        .mockResolvedValueOnce(qr([{ id: 1 }])) // audit CREATED
        .mockResolvedValueOnce(qr([])) // status -> PENDING_APPROVAL
        .mockResolvedValueOnce(qr([{ id: 1 }])) // audit REOPENED
        // ---- getFullQuotationPayload
        .mockResolvedValueOnce(qr([{ ...mockQuote, status: "PENDING_APPROVAL", risk_level: "HIGH", total_overage: "8.0000" }])) // quote
        .mockResolvedValueOnce(qr([])) // lines
        .mockResolvedValueOnce(qr([])); // discount rules

      const res = await request(app)
        .post("/api/v1/quotations/1/lines")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ product_id: 6, quantity: 2, applied_discount_pct: 0 });

      expect(res.status).toBe(201);
      // Re-open stays on PENDING_APPROVAL because the overage stayed HIGH.
      expect(res.body.data.risk_level).toBe("HIGH");
      expect(res.body.data.status).toBe("PENDING_APPROVAL");
      expect(db.query).toHaveBeenCalledTimes(24);
    });

    it("auto-approves when an edit drops the risk to LOW", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([{ id: 1, currency_code: "USD", customer_tier_id: 1 }])) // quote
        .mockResolvedValueOnce(qr([{ id: 6, name: "Hardware", base_cost: "50.0000" }])) // product
        .mockResolvedValueOnce(qr([])) // price list
        .mockResolvedValueOnce(qr([{ id: 12 }])) // insert line
        .mockResolvedValueOnce(qr([{ id: 1 }])) // audit LINE_ADDED
        // ---- recalculateAndPersistQuotation (single line, low discount)
        .mockResolvedValueOnce(qr([ctxRow({ status: "PENDING_APPROVAL" })])) // quote context
        .mockResolvedValueOnce(qr([
          { id: 12, product_id: 6, category_id: 1, quantity: 1, unit_price: "65.0000", unit_cost: "50.0000", applied_discount_pct: "2.00", line_subtotal: "65.0000" },
        ])) // lines
        .mockResolvedValueOnce(qr([discountRule])) // discount rules
        .mockResolvedValueOnce(qr([mediumRule, highRule])) // approval rules
        .mockResolvedValueOnce(qr([])) // line update
        .mockResolvedValueOnce(qr([{ ...mockQuote, status: "PENDING_APPROVAL", risk_level: "LOW", total_overage: "2.0000" }])) // header update
        // ---- reopenApprovalAfterEdit: cancel open request, risk LOW -> approve
        .mockResolvedValueOnce(qr([{ id: 5 }])) // open approval
        .mockResolvedValueOnce(qr([])) // cancel request
        .mockResolvedValueOnce(qr([{ id: 1 }])) // audit CANCELLED
        .mockResolvedValueOnce(qr([])) // status -> APPROVED
        .mockResolvedValueOnce(qr([{ id: 1 }])) // audit APPROVED
        // ---- getFullQuotationPayload
        .mockResolvedValueOnce(qr([{ ...mockQuote, status: "APPROVED", risk_level: "LOW", total_overage: "2.0000" }])) // quote
        .mockResolvedValueOnce(qr([])) // lines
        .mockResolvedValueOnce(qr([])); // discount rules

      const res = await request(app)
        .post("/api/v1/quotations/1/lines")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ product_id: 6, quantity: 1, applied_discount_pct: 2 });

      expect(res.status).toBe(201);
      expect(res.body.data.risk_level).toBe("LOW");
      expect(res.body.data.status).toBe("APPROVED");
      expect(db.query).toHaveBeenCalledTimes(19);
    });
  });

  describe("CONFIRMED quotation hard lock", () => {
    it("returns 409 Conflict when attempting to edit a CONFIRMED quotation", async () => {
      vi.mocked(db.query).mockResolvedValueOnce(qr([ctxRow({ status: "CONFIRMED" })]));

      const res = await request(app)
        .patch("/api/v1/quotations/1")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ order_discount_pct: 5 });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONFLICT");
      expect(res.body.error.message).toContain("locked and cannot be modified");
    });

    it("returns 409 Conflict when attempting to cancel a CONFIRMED quotation", async () => {
      vi.mocked(db.query).mockResolvedValueOnce(qr([ctxRow({ status: "CONFIRMED" })]));

      const res = await request(app)
        .post("/api/v1/quotations/1/cancel")
        .set("Authorization", `Bearer ${repToken()}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONFLICT");
    });
  });

  describe("POST /api/v1/quotations/:id/withdraw", () => {
    it("withdraws a PENDING_APPROVAL quotation to DRAFT", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([ctxRow({ status: "PENDING_APPROVAL", sales_rep_id: 3 })])) // fetch quote
        .mockResolvedValueOnce(qr([{ id: 10 }])) // open approval query
        .mockResolvedValueOnce(qr([])) // update approval status -> CANCELLED
        .mockResolvedValueOnce(qr([{ id: 1 }])) // audit log approval
        .mockResolvedValueOnce(qr([])) // update quote status -> DRAFT
        .mockResolvedValueOnce(qr([{ id: 1 }])) // audit log quote
        // ---- getFullQuotationPayload
        .mockResolvedValueOnce(qr([{ ...mockQuote, status: "DRAFT" }]))
        .mockResolvedValueOnce(qr([]))
        .mockResolvedValueOnce(qr([]));

      const res = await request(app)
        .post("/api/v1/quotations/1/withdraw")
        .set("Authorization", `Bearer ${repToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("DRAFT");
    });

    it("rejects withdrawing a non-PENDING_APPROVAL quotation", async () => {
      vi.mocked(db.query).mockResolvedValueOnce(qr([ctxRow({ status: "DRAFT", sales_rep_id: 3 })]));

      const res = await request(app)
        .post("/api/v1/quotations/1/withdraw")
        .set("Authorization", `Bearer ${repToken()}`);

      expect(res.status).toBe(422);
    });
  });

  describe("POST /api/v1/quotations/:id/cancel", () => {
    it("cancels an active quotation and updates status to CANCELLED without deleting data", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([ctxRow({ status: "DRAFT" })])) // fetch quote
        .mockResolvedValueOnce(qr([])) // open approval query (none)
        .mockResolvedValueOnce(qr([])) // update status -> CANCELLED
        .mockResolvedValueOnce(qr([{ id: 1 }])) // audit log
        // ---- getFullQuotationPayload
        .mockResolvedValueOnce(qr([{ ...mockQuote, status: "CANCELLED" }]))
        .mockResolvedValueOnce(qr([]))
        .mockResolvedValueOnce(qr([]));

      const res = await request(app)
        .post("/api/v1/quotations/1/cancel")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ reason: "Customer changed mind" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("CANCELLED");
    });
  });
});