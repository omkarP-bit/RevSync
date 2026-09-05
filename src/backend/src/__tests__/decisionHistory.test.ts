import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import { quotationsRouter } from "../modules/quotations/quotations.routes.js";
import { approvalsRouter } from "../modules/approvals/approvals.routes.js";
import { errorHandler } from "../middleware/errorHandler.js";
import { query } from "../database/pool.js";
import { ROLES } from "../middleware/auth.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-min-16-chars";

vi.mock("../database/pool.js", () => ({
  query: vi.fn((sql: string, params: any[]) => {
    console.log("SQL:", sql.trim().replace(/\s+/g, " ").slice(0, 60), params);
  }),
  withTransaction: vi.fn((fn: any) => fn({ query: vi.fn() })),
}));

function qr(rows: any[] = []): any {
  return { rows, rowCount: rows.length, command: "", oid: 0, fields: [] };
}

function tokenFor(userId: number, roleId: number): string {
  return jwt.sign({ userId, email: `user${userId}@example.com`, roleId }, JWT_SECRET, { expiresIn: "1h" });
}

function repToken(userId: number = 10): string {
  return tokenFor(userId, ROLES.SALES_REP);
}

function managerToken(): string {
  return tokenFor(20, ROLES.SALES_MANAGER);
}

const app = express();
app.use(express.json());
app.use("/api/v1/quotations", quotationsRouter);
app.use("/api/v1/approvals", approvalsRouter);
app.use(errorHandler);

const baseQuoteCtx = {
  id: 1,
  customer_id: 1,
  sales_rep_id: 10,
  currency_code: "USD",
  tax_rate_pct: 10,
  status: "DRAFT",
  customer_tier_id: 1,
};

const mockQuotePayload = {
  id: 1,
  quotation_number: "QT-2026-0001",
  customer_id: 1,
  customer_name: "Acme Corp",
  customer_tier_id: 1,
  tier_name: "Bronze",
  sales_rep_id: 10,
  sales_rep_name: "Alex Salesrep",
  currency_code: "USD",
  status: "DRAFT",
  subtotal: 1000,
  discount_total: 100,
  order_discount_pct: 0,
  order_discount_amount: 0,
  tax_rate_pct: 10,
  tax_total: 90,
  grand_total: 990,
  total_cost: 600,
  margin_amount: 300,
  margin_pct: 33.33,
  total_overage: 0,
  risk_level: "LOW",
  payment_terms: "NET_30",
  notes: "Test quote",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("Quotation Decision History & Audit Trail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Line Mutations & Before/After Snapshots", () => {
    it("captures full before and after snapshots when a line is added", async () => {
      // 1. fetchQuoteContext (quotations x customers)
      vi.mocked(query).mockResolvedValueOnce(qr([baseQuoteCtx]));
      // 2. product query
      vi.mocked(query).mockResolvedValueOnce(qr([{ id: 5, name: "Widget A", base_cost: 100 }]));
      // 3. price list query
      vi.mocked(query).mockResolvedValueOnce(qr([]));
      // 4. line insert: INSERT INTO quotation_lines ...
      vi.mocked(query).mockResolvedValueOnce(qr([{ id: 101 }]));
      // 5. writeAuditLog insert for LINE_ADDED
      vi.mocked(query).mockResolvedValueOnce(qr([{ id: 1 }]));
      // 6. recalculateAndPersistQuotation (quote context, lines, discount rules, approval rules, line update, header update)
      vi.mocked(query).mockResolvedValueOnce(qr([baseQuoteCtx]));
      vi.mocked(query).mockResolvedValueOnce(qr([{ id: 101, product_id: 5, quantity: 2, unit_price: 130, unit_cost: 100, applied_discount_pct: 0, line_subtotal: 260 }]));
      vi.mocked(query).mockResolvedValueOnce(qr([]));
      vi.mocked(query).mockResolvedValueOnce(qr([]));
      vi.mocked(query).mockResolvedValueOnce(qr([])); // line update
      vi.mocked(query).mockResolvedValueOnce(qr([{ id: 1, subtotal: 260, grand_total: 286, margin_pct: 23.08, risk_level: "LOW" }])); // header update
      // 7. getFullQuotationPayload (quote header, lines, discount rules)
      vi.mocked(query).mockResolvedValueOnce(qr([mockQuotePayload]));
      vi.mocked(query).mockResolvedValueOnce(qr([])); // lines
      vi.mocked(query).mockResolvedValueOnce(qr([])); // discount rules

      const res = await request(app)
        .post("/api/v1/quotations/1/lines")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ product_id: 5, quantity: 2, applied_discount_pct: 0, reason: "Customer requested widget" });

      expect(res.status).toBe(201);
      const auditCall = vi.mocked(query).mock.calls.find(c => typeof c[0] === "string" && c[0].includes("INSERT INTO audit_logs") && c[1]?.[2] === "LINE_ADDED");
      expect(auditCall).toBeDefined();
      expect(auditCall![1]![6]).toBe("Customer requested widget");
    });

    it("classifies QUANTITY_CHANGED action when quantity is updated", async () => {
      // 1. fetchQuoteContext (quotations x customers)
      vi.mocked(query).mockResolvedValueOnce(qr([baseQuoteCtx]));
      // 2. oldLine query
      vi.mocked(query).mockResolvedValueOnce(qr([{ id: 101, product_id: 5, product_sku: "SKU-5", product_name: "Widget A", quantity: 2, unit_price: 130, unit_cost: 100, applied_discount_pct: 0 }]));
      // 3. line UPDATE query
      vi.mocked(query).mockResolvedValueOnce(qr([]));
      // 4. recalculateAndPersistQuotation (quote context, lines, discount rules, approval rules, line update, header update)
      vi.mocked(query).mockResolvedValueOnce(qr([baseQuoteCtx]));
      vi.mocked(query).mockResolvedValueOnce(qr([{ id: 101, product_id: 5, quantity: 5, unit_price: 130, unit_cost: 100, applied_discount_pct: 0, line_subtotal: 650 }]));
      vi.mocked(query).mockResolvedValueOnce(qr([]));
      vi.mocked(query).mockResolvedValueOnce(qr([]));
      vi.mocked(query).mockResolvedValueOnce(qr([]));
      vi.mocked(query).mockResolvedValueOnce(qr([{ id: 1, subtotal: 650, grand_total: 715, margin_pct: 23.08, risk_level: "LOW" }]));
      // 5. writeAuditLog insert
      vi.mocked(query).mockResolvedValueOnce(qr([{ id: 1 }]));
      // 6. getFullQuotationPayload
      vi.mocked(query).mockResolvedValueOnce(qr([mockQuotePayload]));
      vi.mocked(query).mockResolvedValueOnce(qr([]));
      vi.mocked(query).mockResolvedValueOnce(qr([]));

      const res = await request(app)
        .patch("/api/v1/quotations/1/lines/101")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ quantity: 5, reason: "Increased quantity to 5" });

      expect(res.status).toBe(200);
      const auditCall = vi.mocked(query).mock.calls.find(c => typeof c[0] === "string" && c[0].includes("INSERT INTO audit_logs") && c[1]?.[2] === "QUANTITY_CHANGED");
      expect(auditCall).toBeDefined();
    });

    it("captures LINE_REMOVED with previous line snapshot on deletion", async () => {
      // 1. fetchQuoteContext
      vi.mocked(query).mockResolvedValueOnce(qr([baseQuoteCtx]));
      // 2. oldLine query
      vi.mocked(query).mockResolvedValueOnce(qr([{ id: 101, product_id: 5, product_sku: "SKU-5", product_name: "Widget A", quantity: 2, unit_price: 130, unit_cost: 100 }]));
      // 3. line DELETE query
      vi.mocked(query).mockResolvedValueOnce(qr([]));
      // 4. recalculateAndPersistQuotation (quote context, lines, discount rules, approval rules, header update)
      vi.mocked(query).mockResolvedValueOnce(qr([baseQuoteCtx]));
      vi.mocked(query).mockResolvedValueOnce(qr([]));
      vi.mocked(query).mockResolvedValueOnce(qr([]));
      vi.mocked(query).mockResolvedValueOnce(qr([]));
      vi.mocked(query).mockResolvedValueOnce(qr([{ id: 1, subtotal: 0, grand_total: 0, margin_pct: 0, risk_level: "LOW" }]));
      // 5. writeAuditLog insert
      vi.mocked(query).mockResolvedValueOnce(qr([{ id: 1 }]));
      // 6. getFullQuotationPayload
      vi.mocked(query).mockResolvedValueOnce(qr([mockQuotePayload]));
      vi.mocked(query).mockResolvedValueOnce(qr([]));
      vi.mocked(query).mockResolvedValueOnce(qr([]));

      const res = await request(app)
        .delete("/api/v1/quotations/1/lines/101")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ reason: "Product out of stock" });

      expect(res.status).toBe(200);
      const auditCall = vi.mocked(query).mock.calls.find(c => typeof c[0] === "string" && c[0].includes("INSERT INTO audit_logs") && c[1]?.[2] === "LINE_REMOVED");
      expect(auditCall).toBeDefined();
      expect(auditCall![1]![6]).toBe("Product out of stock");
    });
  });

  describe("Quotation Timeline API (/api/v1/quotations/:id/timeline)", () => {
    it("returns paginated timeline items with decision context & derived signals", async () => {
      // 1. fetchQuoteContext
      vi.mocked(query).mockResolvedValueOnce(qr([baseQuoteCtx]));
      // 2. header & customer query
      vi.mocked(query).mockResolvedValueOnce(qr([{
        id: 1, quotation_number: "QT-2026-0001", customer_id: 1, sales_rep_id: 10,
        currency_code: "USD", status: "PENDING_APPROVAL", subtotal: 1000, discount_total: 200,
        order_discount_pct: 5, margin_pct: 25.0, grand_total: 935, risk_level: "HIGH",
        total_overage: 15.0, customer_name: "Acme Corp", payment_terms: "NET_30", tier_name: "Gold"
      }]));
      // 3. approval count
      vi.mocked(query).mockResolvedValueOnce(qr([{ count: "2" }]));
      // 4. negotiation count
      vi.mocked(query).mockResolvedValueOnce(qr([{ count: "1" }]));
      // 5. creation audit query (for historical original metrics)
      vi.mocked(query).mockResolvedValueOnce(qr([{
        id: 1, action: "CREATED", created_at: "2026-09-01T10:00:00Z",
        after: { header: { grand_total: 1100, discount_total: 0, margin_pct: 35.0, risk_level: "LOW" } }
      }]));
      // 6. raw audit logs
      vi.mocked(query).mockResolvedValueOnce(qr([
        {
          id: 10, entity_type: "quotations", entity_id: "1", action: "ORDER_DISCOUNT_CHANGED",
          performed_by: 10, actor_name: "Sales Rep Bob", actor_role: "Sales Rep",
          reason: "Applied manager approved discount", created_at: "2026-09-02T12:00:00Z",
          before: { header: { grand_total: 1100, margin_pct: 35.0 } },
          after: { header: { grand_total: 935, margin_pct: 25.0 } }
        }
      ]));
      // 7. approval steps
      vi.mocked(query).mockResolvedValueOnce(qr([
        { id: 101, sequence: 1, role_id: 2, role_name: "Sales Manager", status: "APPROVED", decider_name: "Alice Manager", decided_at: "2026-09-03T14:00:00Z", notes: "Approved for key deal" }
      ]));

      const res = await request(app)
        .get("/api/v1/quotations/1/timeline?page=1&limit=20")
        .set("Authorization", `Bearer ${repToken(10)}`);

      expect(res.status).toBe(200);
      expect(res.body.data.decision_context.current.grand_total).toBe(935);
      expect(res.body.data.decision_context.current.risk_level).toBe("HIGH");
      expect(res.body.data.decision_context.historical.original_margin_pct).toBe(35);

      // Check derived decision signals
      const signals = res.body.data.decision_signals.map((s: any) => s.text);
      expect(signals).toContain("High Discount Risk");
      expect(signals).toContain("Overage of 15% over allowed tier discount");
      expect(signals).toContain("Approval Required");
      expect(signals).toContain("Margin decreased by 10.0%");

      // Check timeline items
      expect(res.body.data.timeline.length).toBeGreaterThan(0);
      expect(res.body.data.timeline[0].action).toBe("APPROVED");
    });

    it("enforces RBAC ownership check for Sales Reps", async () => {
      // Quote belongs to sales_rep_id = 99, but token is for sales_rep_id = 10
      vi.mocked(query).mockResolvedValueOnce(qr([{ ...baseQuoteCtx, sales_rep_id: 99 }]));
      vi.mocked(query).mockResolvedValueOnce(qr([{ sales_rep_id: 99 }])); // customer check

      const res = await request(app)
        .get("/api/v1/quotations/1/timeline")
        .set("Authorization", `Bearer ${repToken(10)}`);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain("permission");
    });
  });

  describe("Approval Action Reason Capture", () => {
    it("captures approver rationale note during approval decision", async () => {
      // 1. fetch approval request
      vi.mocked(query).mockResolvedValueOnce(qr([{ id: 5, quotation_id: 1, status: "PENDING_APPROVAL", risk_level: "HIGH" }]));
      // 2. fetch approval steps
      vi.mocked(query).mockResolvedValueOnce(qr([{ id: 50, sequence: 1, role_id: ROLES.SALES_MANAGER, status: "PENDING" }]));
      // 3. update approval step
      vi.mocked(query).mockResolvedValueOnce(qr([]));
      // 4. update approval request
      vi.mocked(query).mockResolvedValueOnce(qr([]));
      // 5. update quotation status
      vi.mocked(query).mockResolvedValueOnce(qr([]));
      // 6. writeAuditLog for approval request
      vi.mocked(query).mockResolvedValueOnce(qr([{ id: 1 }]));

      const res = await request(app)
        .post("/api/v1/approvals/5/approve")
        .set("Authorization", `Bearer ${managerToken()}`)
        .send({ notes: "Strategic customer account; approved margin drop" });

      expect(res.status).toBe(200);
      const auditCalls = vi.mocked(query).mock.calls.filter(c => typeof c[0] === "string" && c[0].includes("INSERT INTO audit_logs"));
      expect(auditCalls.length).toBeGreaterThan(0);
      const noteSaved = auditCalls.some(c => c[1]?.[6] === "Strategic customer account; approved margin drop");
      expect(noteSaved).toBe(true);
    });
  });
});

