import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import express from "express";
import request from "supertest";
import { negotiationsRouter, negotiationsPortalRouter } from "../modules/negotiations/negotiations.routes.js";
import { errorHandler } from "../middleware/errorHandler.js";
import * as db from "../database/pool.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-min-16-chars";

function createInternalApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/negotiations", negotiationsRouter);
  app.use(errorHandler);
  return app;
}

function createPortalApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/portal/negotiations", negotiationsPortalRouter);
  app.use(errorHandler);
  return app;
}

const internalApp = createInternalApp();
const portalApp = createPortalApp();

const repToken = () => jwt.sign({ userId: 3, roleId: 1, email: "rep@test.com" }, JWT_SECRET, { expiresIn: "1h" });
const managerToken = () => jwt.sign({ userId: 2, roleId: 2, email: "manager@test.com" }, JWT_SECRET, { expiresIn: "1h" });
const adminToken = () => jwt.sign({ userId: 1, roleId: 5, email: "admin@test.com" }, JWT_SECRET, { expiresIn: "1h" });
const customerToken = (id: number) => jwt.sign({ customerId: id, email: "cust@test.com" }, JWT_SECRET, { expiresIn: "1h" });

const qr = (rows: any[]) => ({ rows, rowCount: rows.length, command: "", oid: 0, fields: [] });

const PUBLIC_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

const negotiationRow = {
  id: 1,
  quotation_id: 1,
  status: "OPEN",
  public_id: PUBLIC_ID,
  quotation_number: "QT-2026-0001",
  customer_id: 1,
  customer_name: "Acme Corp",
  currency_code: "USD",
  grand_total: "990.0000",
  quotation_status: "NEGOTIATION",
};

const ctxRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  customer_id: 1,
  currency_code: "USD",
  tax_rate_pct: "10.00",
  status: "NEGOTIATION",
  customer_tier_id: 1,
  ...overrides,
});

const recalcLine = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  product_id: 5,
  category_id: 1,
  description: "Software License",
  quantity: 10,
  unit_price: "100.0000",
  unit_cost: "60.0000",
  applied_discount_pct: "18.00",
  line_subtotal: "1000.0000",
  ...overrides,
});

const discountRule = { id: 1, customer_tier_id: 1, category_id: 1, max_discount_pct: "10.00", is_active: true };
const mediumRule = { id: 1, risk_level: "MEDIUM", min_total_overage: "5.00", role_sequence: [2], is_active: true };
const highRule = { id: 2, risk_level: "HIGH", min_total_overage: "8.00", role_sequence: [2, 3], is_active: true };

const requestRow = {
  id: 100,
  negotiation_id: 1,
  quotation_line_id: 10,
  product_name: "Software License",
  request_type: "DISCOUNT",
  status: "PENDING",
  original_value: "10.00",
  requested_value: "18",
  message: "Please accept 18%",
  requested_by_customer: true,
  requested_by: null,
  resolved_by: null,
  resolved_at: null,
  created_at: new Date().toISOString(),
};

describe("Negotiations internal routes", () => {
  beforeEach(() => {
    // clearAllMocks keeps getLogger's implementation (resetAllMocks would wipe
    // it and crash the error handler); resetting only db.query clears any
    // unconsumed mockResolvedValueOnce so queues never bleed between tests.
    vi.clearAllMocks();
    vi.mocked(db.query).mockReset();
  });

  describe("POST /api/v1/negotiations", () => {
    it("opens a negotiation and switches the quotation to NEGOTIATION", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([{ id: 1, public_id: PUBLIC_ID, quotation_number: "QT-2026-0001", status: "APPROVED", customer_id: 1, customer_name: "Acme Corp" }]))
        .mockResolvedValueOnce(qr([])) // no open negotiation yet
        .mockResolvedValueOnce(qr([{ id: 1 }])) // INSERT negotiations
        .mockResolvedValueOnce(qr([])) // UPDATE quotations -> NEGOTIATION
        .mockResolvedValueOnce(qr([{ id: 1 }])) // audit
        .mockResolvedValueOnce(qr([negotiationRow])) // payload: negotiation
        .mockResolvedValueOnce(qr([])) // payload: requests
        .mockResolvedValueOnce(qr([])); // payload: messages

      const res = await request(internalApp)
        .post("/api/v1/negotiations")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ quotation_id: 1 });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("OPEN");
      const statusCall = vi.mocked(db.query).mock.calls[3];
      expect(String(statusCall[0])).toContain("NEGOTIATION");
    });

    it("409s when a negotiation is already open", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([{ id: 1, status: "NEGOTIATION", customer_id: 1, customer_name: "Acme Corp" }]))
        .mockResolvedValueOnce(qr([{ id: 1 }])); // existing open negotiation

      const res = await request(internalApp)
        .post("/api/v1/negotiations")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ quotation_id: 1 });

      expect(res.status).toBe(409);
    });

    it("422s when the quotation is still a DRAFT", async () => {
      vi.mocked(db.query).mockResolvedValueOnce(qr([{ id: 1, status: "DRAFT", customer_id: 1, customer_name: "Acme Corp" }]));

      const res = await request(internalApp)
        .post("/api/v1/negotiations")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ quotation_id: 1 });

      expect(res.status).toBe(422);
    });
  });

  describe("GET /api/v1/negotiations", () => {
    it("requires authentication", async () => {
      const res = await request(internalApp).get("/api/v1/negotiations");
      expect(res.status).toBe(401);
    });

    it("returns a paginated list of negotiations", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([{ count: "1" }]))
        .mockResolvedValueOnce(qr([negotiationRow]));

      const res = await request(internalApp)
        .get("/api/v1/negotiations")
        .set("Authorization", `Bearer ${repToken()}`)
        .query({ status: "OPEN" });

      expect(res.status).toBe(200);
      expect(res.body.data[0].quotation_number).toBe("QT-2026-0001");
      expect(res.body.meta.total).toBe(1);
    });
  });

  describe("GET /api/v1/negotiations/:id", () => {
    it("returns a negotiation with its requests and messages", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([negotiationRow]))
        .mockResolvedValueOnce(qr([requestRow]))
        .mockResolvedValueOnce(qr([{ id: 11, sender_type: "CUSTOMER", sender_user_id: null, body: "Can we do better?", created_at: new Date().toISOString() }]));

      const res = await request(internalApp)
        .get("/api/v1/negotiations/1")
        .set("Authorization", `Bearer ${managerToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("OPEN");
      expect(res.body.data.requests).toHaveLength(1);
      expect(res.body.data.requests[0].request_type).toBe("DISCOUNT");
      expect(res.body.data.messages).toHaveLength(1);
    });

    it("404s for an unknown negotiation", async () => {
      vi.mocked(db.query).mockResolvedValueOnce(qr([]));
      const res = await request(internalApp)
        .get("/api/v1/negotiations/999")
        .set("Authorization", `Bearer ${repToken()}`);
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/v1/negotiations/:id/requests", () => {
    it("creates a discount request capturing the current discount as original_value", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([negotiationRow])) // fetchNegotiation
        .mockResolvedValueOnce(qr([recalcLine({ applied_discount_pct: "10.00" })])) // original_value lookup
        .mockResolvedValueOnce(qr([{ id: 100 }])) // INSERT request
        .mockResolvedValueOnce(qr([{ id: 1 }])) // audit
        .mockResolvedValueOnce(qr([negotiationRow])) // payload: negotiation
        .mockResolvedValueOnce(qr([requestRow])) // payload: requests
        .mockResolvedValueOnce(qr([])); // payload: messages

      const res = await request(internalApp)
        .post("/api/v1/negotiations/1/requests")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ request_type: "DISCOUNT", quotation_line_id: 10, requested_value: "18", message: "Please accept 18%" });

      expect(res.status).toBe(201);
      expect(res.body.data.requests[0].requested_value).toBe("18");
      const insertCall = vi.mocked(db.query).mock.calls[2];
      expect(String(insertCall[0])).toContain("original_value");
      expect(insertCall[1]).toContain("10.00");
    });

    it("rejects a DISCOUNT request without a line id", async () => {
      vi.mocked(db.query).mockResolvedValueOnce(qr([negotiationRow]));
      const res = await request(internalApp)
        .post("/api/v1/negotiations/1/requests")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ request_type: "DISCOUNT", requested_value: "18" });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/v1/negotiations/:id/requests/:requestId/accept", () => {
    it("applies the discount and auto-creates approval when risk is HIGH", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([negotiationRow])) // fetchNegotiation
        .mockResolvedValueOnce(qr([requestRow])) // scoped request
        .mockResolvedValueOnce(qr([{ id: 10 }])) // UPDATE quotation_lines
        .mockResolvedValueOnce(qr([{ id: 1 }])) // audit line
        .mockResolvedValueOnce(qr([ctxRow()])) // recalc: quote context
        .mockResolvedValueOnce(qr([recalcLine()])) // recalc: lines (18% applied)
        .mockResolvedValueOnce(qr([discountRule])) // discount rules -> overage 8
        .mockResolvedValueOnce(qr([mediumRule, highRule])) // approval rules
        .mockResolvedValueOnce(qr([])) // line update
        .mockResolvedValueOnce(qr([{ ...negotiationRow, quotation_id: 1, risk_level: "HIGH", total_overage: "8.0000" }])) // header update
        .mockResolvedValueOnce(qr([])) // status -> PENDING_REAPPROVAL
        .mockResolvedValueOnce(qr([])) // reapprove: no open approval
        .mockResolvedValueOnce(qr([mediumRule, highRule])) // reapprove: approval rules
        .mockResolvedValueOnce(qr([{ id: 5, status: "PENDING_APPROVAL", risk_level: "HIGH" }])) // insert approval_request
        .mockResolvedValueOnce(qr([])) // approval step 1 (Sales Manager)
        .mockResolvedValueOnce(qr([])) // approval step 2 (Finance)
        .mockResolvedValueOnce(qr([{ id: 1 }])) // audit CREATED
        .mockResolvedValueOnce(qr([])) // status -> PENDING_APPROVAL
        .mockResolvedValueOnce(qr([])) // UPDATE request ACCEPTED
        .mockResolvedValueOnce(qr([{ id: 1 }])) // audit ACCEPTED
        .mockResolvedValueOnce(qr([negotiationRow])) // payload: negotiation
        .mockResolvedValueOnce(qr([])) // payload: requests
        .mockResolvedValueOnce(qr([])); // payload: messages

      const res = await request(internalApp)
        .post("/api/v1/negotiations/1/requests/100/accept")
        .set("Authorization", `Bearer ${managerToken()}`)
        .send({ notes: "OK" });

      expect(res.status).toBe(200);
      // The shared Phase 4 pipeline must be reused end to end: a fresh
      // approval_request is created for the re-risked discount.
      const approvalInsert = vi.mocked(db.query).mock.calls[13];
      expect(String(approvalInsert[0])).toContain("INSERT INTO approval_requests");
      expect(approvalInsert[1]).toEqual([1, "HIGH", 8, 2, "Auto re-approved after negotiation-accepted discount"]);
      expect(db.query).toHaveBeenCalledTimes(23);
    });

    it("auto-approves the quotation when the accepted discount stays within limits", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([negotiationRow])) // fetchNegotiation
        .mockResolvedValueOnce(qr([{ ...requestRow, requested_value: "5" }])) // scoped request
        .mockResolvedValueOnce(qr([{ id: 10 }])) // UPDATE quotation_lines
        .mockResolvedValueOnce(qr([{ id: 1 }])) // audit line
        .mockResolvedValueOnce(qr([ctxRow()])) // recalc quote context
        .mockResolvedValueOnce(qr([recalcLine({ applied_discount_pct: "5.00" })])) // recalc lines
        .mockResolvedValueOnce(qr([discountRule])) // discount rules
        .mockResolvedValueOnce(qr([mediumRule, highRule])) // approval rules
        .mockResolvedValueOnce(qr([])) // line update
        .mockResolvedValueOnce(qr([{ ...negotiationRow, risk_level: "LOW", total_overage: "0.0000" }])) // header update
        .mockResolvedValueOnce(qr([])) // status -> APPROVED
        .mockResolvedValueOnce(qr([])) // reapprove: no open approval
        .mockResolvedValueOnce(qr([])) // reapprove LOW: status -> APPROVED
        .mockResolvedValueOnce(qr([{ id: 1 }])) // audit APPROVED
        .mockResolvedValueOnce(qr([])) // UPDATE request ACCEPTED
        .mockResolvedValueOnce(qr([{ id: 1 }])) // audit ACCEPTED
        .mockResolvedValueOnce(qr([negotiationRow])) // payload: negotiation
        .mockResolvedValueOnce(qr([])) // payload: requests
        .mockResolvedValueOnce(qr([])); // payload: messages

      const res = await request(internalApp)
        .post("/api/v1/negotiations/1/requests/100/accept")
        .set("Authorization", `Bearer ${managerToken()}`);

      expect(res.status).toBe(200);
      // No approval request should be created for a LOW-re-risk quotation.
      const created = vi.mocked(db.query).mock.calls.filter((c) => String(c[0]).includes("INSERT INTO approval_requests"));
      expect(created).toHaveLength(0);
      // The post-accept recalculation must preserve the line's unit_price (regression:
      // an accepted discount must never zero out the price).
      const recalcLineUpdate = vi.mocked(db.query).mock.calls.find((c) => String(c[0]).includes("unit_price = $2"));
      expect(recalcLineUpdate).toBeTruthy();
      const [, params] = recalcLineUpdate as [string, unknown[]];
      expect(params[1]).toBe(100); // unit_price survives; only discount/qty change
    });

    it("forbids Sales Reps from accepting requests", async () => {
      vi.mocked(db.query).mockResolvedValueOnce(qr([negotiationRow]));
      const res = await request(internalApp)
        .post("/api/v1/negotiations/1/requests/100/accept")
        .set("Authorization", `Bearer ${repToken()}`);
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/v1/negotiations/:id/requests/:requestId/reject", () => {
    it("marks the request REJECTED without touching the quotation", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([negotiationRow])) // fetchNegotiation
        .mockResolvedValueOnce(qr([requestRow])) // scoped request
        .mockResolvedValueOnce(qr([])) // UPDATE request REJECTED
        .mockResolvedValueOnce(qr([{ id: 1 }])) // audit
        .mockResolvedValueOnce(qr([negotiationRow])) // payload: negotiation
        .mockResolvedValueOnce(qr([{ ...requestRow, status: "REJECTED" }])) // payload: requests
        .mockResolvedValueOnce(qr([])); // payload: messages

      const res = await request(internalApp)
        .post("/api/v1/negotiations/1/requests/100/reject")
        .set("Authorization", `Bearer ${managerToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.requests[0].status).toBe("REJECTED");
      expect(db.query).toHaveBeenCalledTimes(7);
    });
  });

  describe("POST /api/v1/negotiations/:id/messages", () => {
    it("posts a sales message to the negotiation thread", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([negotiationRow])) // fetchNegotiation (open)
        .mockResolvedValueOnce(qr([{ id: 21 }])) // INSERT message
        .mockResolvedValueOnce(qr([{ id: 1 }])) // audit
        .mockResolvedValueOnce(qr([negotiationRow])) // payload: negotiation
        .mockResolvedValueOnce(qr([])) // payload: requests
        .mockResolvedValueOnce(qr([{ id: 21, sender_type: "SALES", body: "Done" }])); // payload: messages

      const res = await request(internalApp)
        .post("/api/v1/negotiations/1/messages")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ body: "We accept 15% for the hardware." });

      expect(res.status).toBe(201);
      expect(res.body.data.messages[0].sender_type).toBe("SALES");
    });
  });
});

describe("Negotiations portal routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.query).mockReset();
  });

  it("requires customer authentication", async () => {
    const res = await request(portalApp).get(`/api/v1/portal/negotiations/${PUBLIC_ID}`);
    expect(res.status).toBe(401);
  });

  it("lists the customer's negotiations", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(qr([{ count: "1" }]))
      .mockResolvedValueOnce(qr([{ id: 1, public_id: PUBLIC_ID, quotation_number: "QT-2026-0001", currency_code: "USD", grand_total: "990.0000", quotation_status: "NEGOTIATION", negotiation_status: "OPEN", updated_at: new Date().toISOString() }]));

    const res = await request(portalApp)
      .get(`/api/v1/portal/negotiations`)
      .set("Authorization", `Bearer ${customerToken(1)}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].public_id).toBe(PUBLIC_ID);
    expect(res.body.meta.total).toBe(1);
  });

  it("returns the negotiation, lines, requests and messages for the customer's own quote", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(qr([negotiationRow])) // find by public_id
      .mockResolvedValueOnce(qr([requestRow])) // requests
      .mockResolvedValueOnce(qr([])) // messages
      .mockResolvedValueOnce(qr([{ id: 10, product_id: 5, product_name: "Software License", description: null, quantity: 10, unit_price: "100.0000", applied_discount_pct: "18.00", line_total: "820.0000" }])); // lines

    const res = await request(portalApp)
      .get(`/api/v1/portal/negotiations/${PUBLIC_ID}`)
      .set("Authorization", `Bearer ${customerToken(1)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.quotation_number).toBe("QT-2026-0001");
    expect(res.body.data.lines).toHaveLength(1);
    // Portal payload must not leak internal fields.
    expect(JSON.stringify(res.body.data)).not.toMatch(/base_cost|margin|risk_level|total_overage/i);
    expect(res.body.data.requests[0].requested_by_customer).toBe(true);
  });

  it("forbids a customer from viewing another customer's negotiation", async () => {
    vi.mocked(db.query).mockResolvedValueOnce(qr([negotiationRow]));
    const res = await request(portalApp)
      .get(`/api/v1/portal/negotiations/${PUBLIC_ID}`)
      .set("Authorization", `Bearer ${customerToken(2)}`);
    expect(res.status).toBe(403);
  });

  it("lets a customer submit a discount request", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(qr([{ id: 1, status: "OPEN", quotation_id: 1, customer_id: 1 }]))
      .mockResolvedValueOnce(qr([recalcLine({ applied_discount_pct: "10.00" })])) // original_value
      .mockResolvedValueOnce(qr([{ id: 100 }])) // INSERT
      .mockResolvedValueOnce(qr([{ id: 1 }])); // audit

    const res = await request(portalApp)
      .post(`/api/v1/portal/negotiations/${PUBLIC_ID}/requests`)
      .set("Authorization", `Bearer ${customerToken(1)}`)
      .send({ request_type: "DISCOUNT", quotation_line_id: 10, requested_value: "18", message: "Please accept 18%" });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("PENDING");
    const insertCall = vi.mocked(db.query).mock.calls[2];
    // requested_by_customer is hardcoded TRUE in the SQL for portal submissions.
    expect(String(insertCall[0])).toContain("requested_by_customer");
    expect(String(insertCall[0])).toContain("true");
  });

  it("lets a customer post a message", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(qr([{ id: 1, status: "OPEN", customer_id: 1 }])) // negotiation lookup
      .mockResolvedValueOnce(qr([{ id: 22 }])); // INSERT message

    const res = await request(portalApp)
      .post(`/api/v1/portal/negotiations/${PUBLIC_ID}/messages`)
      .set("Authorization", `Bearer ${customerToken(1)}`)
      .send({ body: "Can you ship earlier?" });

    expect(res.status).toBe(201);
  });
});