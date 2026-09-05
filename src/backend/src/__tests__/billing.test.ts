import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import express from "express";
import request from "supertest";
import { invoicesRouter, creditNotesRouter, invoicesPortalRouter } from "../modules/billing/billing.routes.js";
import { errorHandler } from "../middleware/errorHandler.js";
import * as db from "../database/pool.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-min-16-chars";

function createInternalApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/invoices", invoicesRouter);
  app.use("/api/v1/credit-notes", creditNotesRouter);
  app.use(errorHandler);
  return app;
}

function createPortalApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/portal/invoices", invoicesPortalRouter);
  app.use(errorHandler);
  return app;
}

const internalApp = createInternalApp();
const portalApp = createPortalApp();

const repToken = () => jwt.sign({ userId: 3, roleId: 1, email: "rep@test.com" }, JWT_SECRET, { expiresIn: "1h" });
const managerToken = () => jwt.sign({ userId: 2, roleId: 2, email: "manager@test.com" }, JWT_SECRET, { expiresIn: "1h" });
const financeToken = () => jwt.sign({ userId: 4, roleId: 3, email: "finance@test.com" }, JWT_SECRET, { expiresIn: "1h" });
const warehouseToken = () => jwt.sign({ userId: 5, roleId: 4, email: "wh@test.com" }, JWT_SECRET, { expiresIn: "1h" });
const adminToken = () => jwt.sign({ userId: 1, roleId: 5, email: "admin@test.com" }, JWT_SECRET, { expiresIn: "1h" });
const customerToken = (id: number) => jwt.sign({ customerId: id, email: "cust@test.com" }, JWT_SECRET, { expiresIn: "1h" });

const qr = (rows: any[] = []) => ({ rows, rowCount: rows.length, command: "", oid: 0, fields: [] });
const numeric = (val: string) => parseFloat(val);

const now = () => new Date().toISOString();

const confirmedQuoteRow = {
  id: "7",
  quotation_number: "QT-2026-0007",
  customer_id: "2",
  currency_code: "USD",
  tax_rate_pct: "10.00",
  order_discount_pct: "5.00",
  status: "CONFIRMED",
  payment_terms: "NET_30",
};

const oneTimeLine = (id: number, productId: number, name: string, sku: string, qty: number, price: string, cost: string, discPct: string, productType = "ONE_TIME") => ({
  id: String(id),
  product_id: String(productId),
  description: name,
  quantity: qty,
  unit_price: price,
  unit_cost: cost,
  applied_discount_pct: discPct,
  product_name: name,
  sku,
  product_type: productType,
});

const invoiceRow = {
  id: "1",
  invoice_number: "INV-2026-0001",
  public_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  quotation_id: "7",
  customer_id: "2",
  currency_code: "USD",
  status: "ISSUED",
  issue_date: now(),
  due_date: now(),
  subtotal: "1000.0000",
  discount_total: "50.0000",
  order_discount_pct: "5.00",
  order_discount_amount: "47.5000",
  tax_rate_pct: "10.00",
  tax_total: "94.5250",
  grand_total: "1039.7750",
  total_paid: "0",
  notes: null,
  created_at: now(),
  updated_at: now(),
  customer_name: "Acme",
  quotation_number: "QT-2026-0007",
  sales_rep_email: "rep@test.com",
};

type QueryMock = {
  query: ReturnType<typeof vi.fn>;
};

function mockClient(): QueryMock {
  return { query: vi.fn() };
}

describe("Billing routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.query).mockReset();
    (db.withTransaction as any).mockReset();
  });

  describe("Invoice generation POST /api/v1/invoices", () => {
    it("requires auth", async () => {
      const res = await request(internalApp).post("/api/v1/invoices").send({ quotation_id: 7 });
      expect(res.status).toBe(401);
    });

    it("restricts generation to finance/admin", async () => {
      const res = await request(internalApp)
        .post("/api/v1/invoices")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ quotation_id: 7 });
      expect(res.status).toBe(403);
    });

    it("creates an invoice from a confirmed quotation with lines", async () => {
      const lines = [
        oneTimeLine(10, 5, "Enterprise Platform", "SW-ENT-001", 2, "500.0000", "300.0000", "10.00"),
        oneTimeLine(11, 6, "Support Retainer", "SW-SUP-002", 1, "200.0000", "100.0000", "0"),
      ];

      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([confirmedQuoteRow]))
        .mockResolvedValueOnce(qr([])) // no existing invoice
        .mockResolvedValueOnce(qr(lines)) // one-time lines
        .mockResolvedValueOnce(qr([invoiceRow])) // invoice select
        .mockResolvedValueOnce(qr([])) // lines select (from loadInvoice)
        .mockResolvedValueOnce(qr([])) // payments select
        .mockResolvedValueOnce(qr([])); // credit notes select

      const client = mockClient();
      client.query
        .mockResolvedValueOnce(qr([{ count: "0" }])) // invoice number count
        .mockResolvedValueOnce(qr([{ id: "1" }])) // invoice insert
        .mockResolvedValueOnce(qr([{ id: "100" }])) // line 1
        .mockResolvedValueOnce(qr([{ id: "101" }])) // line 2
        .mockResolvedValueOnce(qr()); // audit
      vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => fn(client));

      const res = await request(internalApp)
        .post("/api/v1/invoices")
        .set("Authorization", `Bearer ${financeToken()}`)
        .send({ quotation_id: 7 });

      expect(res.status).toBe(201);
      expect(res.body.data.invoice_number).toBe("INV-2026-0001");
      expect(res.body.data.status).toBe("ISSUED");
      expect(res.body.data.grand_total).toBeCloseTo(1039.775, 3);
      expect(res.body.data.total_paid).toBe(0);
    });

    it("creates an invoice from a confirmed recurring-only quotation (all lines invoiced)", async () => {
      const lines = [
        oneTimeLine(10, 5, "Managed Support", "SW-SUP-003", 1, "3000.0000", "1500.0000", "0", "RECURRING"),
      ];

      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([{ ...confirmedQuoteRow, quotation_number: "QT-2026-0003" }]))
        .mockResolvedValueOnce(qr([])) // no existing invoice
        .mockResolvedValueOnce(qr(lines)) // recurring line
        .mockResolvedValueOnce(qr([{ ...invoiceRow, quotation_number: "QT-2026-0003" }])) // invoice select
        .mockResolvedValueOnce(qr([])) // lines select
        .mockResolvedValueOnce(qr([])) // payments select
        .mockResolvedValueOnce(qr([])); // credit notes select

      const client = mockClient();
      client.query
        .mockResolvedValueOnce(qr([{ count: "0" }]))
        .mockResolvedValueOnce(qr([{ id: "1" }])) // invoice insert
        .mockResolvedValueOnce(qr([{ id: "200" }])) // line 1
        .mockResolvedValueOnce(qr()); // audit
      vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => fn(client));

      const res = await request(internalApp)
        .post("/api/v1/invoices")
        .set("Authorization", `Bearer ${financeToken()}`)
        .send({ quotation_id: 3 });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("ISSUED");
      expect(res.body.data.total_paid).toBe(0);
    });

    it("rejects non-confirmed quotations", async () => {
      vi.mocked(db.query).mockResolvedValueOnce(
        qr([{ ...confirmedQuoteRow, status: "APPROVED", order_discount_pct: "0.00" }])
      );
      const res = await request(internalApp)
        .post("/api/v1/invoices")
        .set("Authorization", `Bearer ${financeToken()}`)
        .send({ quotation_id: 7 });
      expect(res.status).toBe(422);
    });

    it("rejects duplicate invoice per quotation", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([confirmedQuoteRow]))
        .mockResolvedValueOnce(qr([{ id: "1" }])); // existing invoice
      const res = await request(internalApp)
        .post("/api/v1/invoices")
        .set("Authorization", `Bearer ${financeToken()}`)
        .send({ quotation_id: 7 });
      expect(res.status).toBe(409);
    });

    it("rejects quotations with no lines", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([confirmedQuoteRow]))
        .mockResolvedValueOnce(qr([]))
        .mockResolvedValueOnce(qr([])); // no quotation lines
      const res = await request(internalApp)
        .post("/api/v1/invoices")
        .set("Authorization", `Bearer ${financeToken()}`)
        .send({ quotation_id: 7 });
      expect(res.status).toBe(422);
    });
  });

  describe("GET /api/v1/invoices and billable-quotations", () => {
    it("lists invoices with pagination (allowed for rep)", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([{ count: "1" }]))
        .mockResolvedValueOnce(
          qr([
            {
              id: "1", invoice_number: "INV-2026-0001", public_id: "x", customer_id: "2",
              status: "ISSUED", issue_date: now(), due_date: now(), grand_total: "1039.7750",
              total_paid: "0", created_at: now(), customer_name: "Acme", quotation_number: "QT-2026-0007",
            },
          ])
        );

      const res = await request(internalApp)
        .get("/api/v1/invoices")
        .set("Authorization", `Bearer ${repToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].balance_due).toBeCloseTo(1039.775, 3);
      expect(res.body.meta.total).toBe(1);
    });

    it("restricts warehouse managers from listing invoices", async () => {
      const res = await request(internalApp)
        .get("/api/v1/invoices")
        .set("Authorization", `Bearer ${warehouseToken()}`);
      expect(res.status).toBe(403);
    });

    it("returns billable quotations for all confirmed quotes (finance only)", async () => {
      vi.mocked(db.query).mockResolvedValueOnce(
        qr([
          {
            id: "3", quotation_number: "QT-2026-0003", currency_code: "USD",
            grand_total: "1623.6000", customer_name: "Acme", created_at: now(),
          },
          {
            id: "7", quotation_number: "QT-2026-0007", currency_code: "USD",
            grand_total: "1039.7750", customer_name: "Acme", created_at: now(),
          },
        ])
      );
      const res = await request(internalApp)
        .get("/api/v1/invoices/billable-quotations")
        .set("Authorization", `Bearer ${financeToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[1].id).toBe(7);
    });
  });

  describe("GET /api/v1/invoices/:id", () => {
    it("returns full invoice with lines, payments, credit notes", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([invoiceRow]))
        .mockResolvedValueOnce(
          qr([
            {
              id: "10", quotation_line_id: "10", product_id: "5", product_name: "Enterprise Platform",
              sku: "SW-ENT-001", description: "Platform", quantity: 2, unit_price: "500.0000",
              applied_discount_pct: "10.00", discount_amount: "100.0000", line_subtotal: "1000.0000",
              line_total: "900.0000", line_cost: "600.0000", line_margin: "300.0000", created_at: now(),
            },
          ])
        )
        .mockResolvedValueOnce(qr([]))
        .mockResolvedValueOnce(qr([]));

      const res = await request(internalApp)
        .get("/api/v1/invoices/1")
        .set("Authorization", `Bearer ${financeToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.data.invoice_number).toBe("INV-2026-0001");
      expect(res.body.data.lines).toHaveLength(1);
      expect(res.body.data.lines[0].unit_price).toBe(500);
    });
  });

  describe("POST /api/v1/invoices/:id/payments", () => {
    it("records a payment and moves invoice to PARTIALLY_PAID", async () => {
      const paidInvoice = { ...invoiceRow, status: "PARTIALLY_PAID", total_paid: "500.0000" };
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([{ id: "1", grand_total: "1039.7750", total_paid: "0", status: "ISSUED" }]))
        .mockResolvedValueOnce(qr([])) // no existing payment
        .mockResolvedValueOnce(qr([paidInvoice])) // loadInvoice select
        .mockResolvedValueOnce(qr([]))
        .mockResolvedValueOnce(qr([{ id: "20", reference: "PAY-001", amount_paid: "500.0000", payment_date: now(), payment_method: "BANK_TRANSFER" }]))
        .mockResolvedValueOnce(qr([]));

      const client = mockClient();
      client.query
        .mockResolvedValueOnce(qr([{ id: "20" }])) // payment insert
        .mockResolvedValueOnce(qr()) // invoice update
        .mockResolvedValueOnce(qr()); // audit
      vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => fn(client));

      const res = await request(internalApp)
        .post("/api/v1/invoices/1/payments")
        .set("Authorization", `Bearer ${financeToken()}`)
        .send({ reference: "PAY-001", amount_paid: 500, payment_method: "BANK_TRANSFER" });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("PARTIALLY_PAID");
      expect(res.body.data.total_paid).toBe(500);
    });

    it("completes a fully paid invoice to PAID", async () => {
      const paidInvoice = { ...invoiceRow, status: "PAID", total_paid: "1039.7750" };
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([{ id: "1", grand_total: "1039.7750", total_paid: "0", status: "ISSUED" }]))
        .mockResolvedValueOnce(qr([]))
        .mockResolvedValueOnce(qr([paidInvoice]))
        .mockResolvedValueOnce(qr([]))
        .mockResolvedValueOnce(qr([]))
        .mockResolvedValueOnce(qr([]));

      const client = mockClient();
      client.query
        .mockResolvedValueOnce(qr([{ id: "21" }]))
        .mockResolvedValueOnce(qr())
        .mockResolvedValueOnce(qr());
      vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => fn(client));

      const res = await request(internalApp)
        .post("/api/v1/invoices/1/payments")
        .set("Authorization", `Bearer ${financeToken()}`)
        .send({ reference: "PAY-002", amount_paid: 1039.775, payment_method: "BANK_TRANSFER" });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("PAID");
    });

    it("rejects payments on a cancelled invoice", async () => {
      vi.mocked(db.query).mockResolvedValueOnce(
        qr([{ id: "1", grand_total: "1039.7750", total_paid: "0", status: "CANCELLED" }])
      );
      const res = await request(internalApp)
        .post("/api/v1/invoices/1/payments")
        .set("Authorization", `Bearer ${financeToken()}`)
        .send({ reference: "PAY-003", amount_paid: 100 });
      expect(res.status).toBe(422);
    });
  });

  describe("POST /api/v1/invoices/:id/cancel", () => {
    it("cancels an ISSUED invoice", async () => {
      const cancelled = { ...invoiceRow, status: "CANCELLED" };
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([{ id: "1", status: "ISSUED", total_paid: "0", grand_total: "1039.7750" }]))
        .mockResolvedValueOnce(qr([cancelled]))
        .mockResolvedValueOnce(qr([]))
        .mockResolvedValueOnce(qr([]))
        .mockResolvedValueOnce(qr([]));

      const client = mockClient();
      client.query
        .mockResolvedValueOnce(qr())
        .mockResolvedValueOnce(qr());
      vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => fn(client));

      const res = await request(internalApp)
        .post("/api/v1/invoices/1/cancel")
        .set("Authorization", `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("CANCELLED");
    });

    it("rejects cancelling a paid invoice", async () => {
      vi.mocked(db.query).mockResolvedValueOnce(
        qr([{ id: "1", status: "PAID", total_paid: "1039.7750", grand_total: "1039.7750" }])
      );
      const res = await request(internalApp)
        .post("/api/v1/invoices/1/cancel")
        .set("Authorization", `Bearer ${adminToken()}`);
      expect(res.status).toBe(422);
    });
  });

  describe("Credit notes", () => {
    it("lists credit notes (finance)", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([{ count: "1" }]))
        .mockResolvedValueOnce(
          qr([
            {
              id: "1", credit_note_number: "CN-2026-0001", public_id: "y", invoice_id: "1",
              customer_id: "2", currency_code: "USD", amount: "100.0000", reason: "Refund",
              status: "ISSUED", created_at: now(), customer_name: "Acme", invoice_number: "INV-2026-0001",
            },
          ])
        );
      const res = await request(internalApp)
        .get("/api/v1/credit-notes")
        .set("Authorization", `Bearer ${financeToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.data[0].amount).toBe(100);
    });

    it("creates a credit note against an invoice", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([{ currency_code: "USD" }])) // customer
        .mockResolvedValueOnce(
          qr([{ id: "1", customer_id: "2", currency_code: "USD", status: "ISSUED", total_paid: "500", grand_total: "1039.7750" }])
        ) // invoice
        .mockResolvedValueOnce(
          qr([
            {
              id: "1", credit_note_number: "CN-2026-0001", public_id: "y", invoice_id: "1",
              customer_id: "2", currency_code: "USD", amount: "100.0000", reason: "Refund",
              status: "ISSUED", created_at: now(), customer_name: "Acme", invoice_number: "INV-2026-0001",
            },
          ])
        ); // detail

      const client = mockClient();
      client.query
        .mockResolvedValueOnce(qr([{ count: "0" }]))
        .mockResolvedValueOnce(qr([{ id: "1" }])) // insert
        .mockResolvedValueOnce(qr()); // audit
      vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => fn(client));

      const res = await request(internalApp)
        .post("/api/v1/credit-notes")
        .set("Authorization", `Bearer ${financeToken()}`)
        .send({ invoice_id: 1, customer_id: 2, amount: 100, reason: "Refund" });

      expect(res.status).toBe(201);
      expect(res.body.data.credit_note_number).toBe("CN-2026-0001");
    });
  });

  describe("Portal invoices", () => {
    it("requires customer auth", async () => {
      const res = await request(portalApp).get("/api/v1/portal/invoices");
      expect(res.status).toBe(401);
    });

    it("lists only the customer's own invoices (sanitized)", async () => {
      vi.mocked(db.query).mockResolvedValueOnce(
        qr([
          {
            id: "1", invoice_number: "INV-2026-0001", public_id: "aaa", customer_id: "2",
            status: "ISSUED", issue_date: now(), due_date: now(), grand_total: "1039.7750",
            total_paid: "0", created_at: now(), quotation_number: "QT-2026-0007",
          },
        ])
      );
      const res = await request(portalApp)
        .get("/api/v1/portal/invoices")
        .set("Authorization", `Bearer ${customerToken(2)}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].grand_total).toBeCloseTo(1039.775, 3);
      expect(res.body.data[0]).not.toHaveProperty("unit_cost");
      expect(res.body.data[0]).not.toHaveProperty("line_cost");
    });

    it("returns 404 for an invoice that belongs to another customer", async () => {
      vi.mocked(db.query).mockResolvedValueOnce(
        qr([
          {
            id: "1", invoice_number: "INV-2026-0001", quotation_id: "7", customer_id: "9",
            status: "ISSUED", issue_date: now(), due_date: now(), grand_total: "1039.7750",
            total_paid: "0", quotation_number: "QT-2026-0007",
          },
        ])
      );
      const res = await request(portalApp)
        .get("/api/v1/portal/invoices/aaa")
        .set("Authorization", `Bearer ${customerToken(2)}`);
      expect(res.status).toBe(404);
    });

    it("returns sanitized invoice detail for the owner", async () => {
      const owned = {
        id: "1", invoice_number: "INV-2026-0001", quotation_id: "7", customer_id: "2",
        status: "ISSUED", issue_date: now(), due_date: now(), grand_total: "1039.7750",
        total_paid: "0", quotation_number: "QT-2026-0007",
      };
      vi.mocked(db.query)
        .mockResolvedValueOnce(qr([owned]))
        .mockResolvedValueOnce(
          qr([
            {
              product_name: "Enterprise Platform", sku: "SW-ENT-001", description: "Platform",
              quantity: 2, unit_price: "500.0000", applied_discount_pct: "10.00",
              discount_amount: "100.0000", line_total: "900.0000",
            },
          ])
        )
        .mockResolvedValueOnce(qr([]));

      const res = await request(portalApp)
        .get("/api/v1/portal/invoices/aaa")
        .set("Authorization", `Bearer ${customerToken(2)}`);
      expect(res.status).toBe(200);
      expect(res.body.data.invoice_number).toBe("INV-2026-0001");
      expect(res.body.data.lines).toHaveLength(1);
      expect(res.body.data.lines[0]).not.toHaveProperty("unit_cost");
      expect(res.body.data).not.toHaveProperty("unit_cost");
    });
  });
});