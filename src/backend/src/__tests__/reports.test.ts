import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import express from "express";
import request from "supertest";
import { reportsRouter } from "../modules/reports/reports.routes.js";
import { errorHandler } from "../middleware/errorHandler.js";
import * as db from "../database/pool.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-min-16-chars";

const qr = (rows: any[] = []) => ({ rows, rowCount: rows.length, command: "", oid: 0, fields: [] });

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/reports", reportsRouter);
  app.use(errorHandler);
  return app;
}

const app = createApp();

const adminToken = () => jwt.sign({ userId: 1, roleId: 5, email: "admin@test.com" }, JWT_SECRET, { expiresIn: "1h" });
const financeToken = () => jwt.sign({ userId: 2, roleId: 3, email: "finance@test.com" }, JWT_SECRET, { expiresIn: "1h" });
const repToken = () => jwt.sign({ userId: 3, roleId: 1, email: "rep@test.com" }, JWT_SECRET, { expiresIn: "1h" });
const managerToken = () => jwt.sign({ userId: 4, roleId: 2, email: "manager@test.com" }, JWT_SECRET, { expiresIn: "1h" });
const warehouseToken = () => jwt.sign({ userId: 5, roleId: 4, email: "warehouse@test.com" }, JWT_SECRET, { expiresIn: "1h" });

describe("Reports routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.query).mockReset();
  });

  it("requires auth", async () => {
    const res = await request(app).get("/api/v1/reports/overview");
    expect(res.status).toBe(401);
  });

  it("allows admin to access overview", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(qr([{ total_count: 10, confirmed_count: 3, confirmed_value: "15000.00", open_value: "25000.00" }]))
      .mockResolvedValueOnce(qr([{ total_count: 2, invoiced: "12000.00", collected: "8000.00", outstanding: "4000.00", overdue_count: 0 }]))
      .mockResolvedValueOnce(qr([{ orders_total: 5, partial_count: 1, units_backordered: 3 }]))
      .mockResolvedValueOnce(qr([{ active_count: 4, mrr: "2200.00" }]))
      .mockResolvedValueOnce(qr([{ status: "HEALTHY", count: 2 }, { status: "CRITICAL", count: 1 }]))
      .mockResolvedValueOnce(qr([{ currency_code: "USD" }]));
    const res = await request(app).get("/api/v1/reports/overview").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.pipeline.total_quotations).toBe(10);
    expect(res.body.data.pipeline.win_rate).toBe(30);
    expect(res.body.data.revenue.invoiced).toBe(12000);
    expect(res.body.data.revenue.collected).toBe(8000);
    expect(res.body.data.revenue.overdue_count).toBe(0);
    expect(res.body.data.fulfillment.units_backordered).toBe(3);
    expect(res.body.data.subscriptions.active_count).toBe(4);
    expect(res.body.data.subscriptions.monthly_recurring_value).toBe(2200);
    expect(res.body.data.deal_health.healthy).toBe(2);
    expect(res.body.data.deal_health.critical).toBe(1);
    expect(res.body.meta.generated_at).toBeTruthy();
  });

  it("allows sales rep to access overview", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(qr([{ total_count: 0, confirmed_count: 0, confirmed_value: null, open_value: null }]))
      .mockResolvedValueOnce(qr([{ total_count: 0, invoiced: null, collected: null, outstanding: null, overdue_count: 0 }]))
      .mockResolvedValueOnce(qr([{ orders_total: 0, partial_count: 0, units_backordered: 0 }]))
      .mockResolvedValueOnce(qr([{ active_count: 0, mrr: null }]))
      .mockResolvedValueOnce(qr([]))
      .mockResolvedValueOnce(qr([]));
    const res = await request(app).get("/api/v1/reports/overview").set("Authorization", `Bearer ${repToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.pipeline.confirmed_value).toBe(0);
    expect(res.body.data.base_currency).toBe("USD");
  });

  it("returns revenue series for admin", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(qr([{ period: "2026-01", invoiced: "5000.00", collected: "4000.00", outstanding: "1000.00" }]))
      .mockResolvedValueOnce(qr([{ period: "2026-01", collected: "1000.00" }]))
      .mockResolvedValueOnce(qr([{ currency_code: "USD" }]));
    const res = await request(app).get("/api/v1/reports/revenue?from=2026-01-01&to=2026-01-31").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.from).toBe("2026-01-01");
    expect(res.body.data.to).toBe("2026-01-31");
    expect(res.body.data.months).toHaveLength(1);
    expect(res.body.data.months[0]).toMatchObject({ period: "2026-01", invoiced: 5000, collected: 5000, outstanding: 0 });
  });

  it("rejects invalid from date on revenue", async () => {
    const res = await request(app).get("/api/v1/reports/revenue?from=bad&to=2026-01-31").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(400);
  });

  it("returns sales breakdown with sales reps and top customers", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(qr([{ sales_rep_id: 1, sales_rep_name: "Alice", quotation_count: 5, confirmed_count: 2, confirmed_value: "8000.00", pipeline_value: "12000.00" }]))
      .mockResolvedValueOnce(qr([{ customer_id: 10, customer_name: "Acme Corp", company: "Acme", invoice_count: 3, invoiced: "6000.00", collected: "4500.00", overdue_count: 0 }]));
    const res = await request(app).get("/api/v1/reports/sales?from=2026-01-01&to=2026-12-31").set("Authorization", `Bearer ${financeToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.sales_reps).toHaveLength(1);
    expect(res.body.data.sales_reps[0].sales_rep_name).toBe("Alice");
    expect(res.body.data.sales_reps[0].confirmed_value).toBe(8000);
    expect(res.body.data.top_customers).toHaveLength(1);
    expect(res.body.data.top_customers[0].customer_name).toBe("Acme Corp");
  });

  it("returns pipeline funnel with counts and values", async () => {
    vi.mocked(db.query).mockResolvedValueOnce(
      qr([
        { status: "DRAFT", count: 2, value: "10000.00" },
        { status: "APPROVED", count: 1, value: "5000.00" },
        { status: "CONFIRMED", count: 3, value: "18000.00" },
      ])
    );
    const res = await request(app).get("/api/v1/reports/pipeline?from=2026-01-01&to=2026-12-31").set("Authorization", `Bearer ${managerToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(6);
    expect(res.body.data.value).toBe(33000);
    expect(res.body.data.statuses.map((s: any) => s.status)).toEqual(["DRAFT", "APPROVED", "CONFIRMED"]);
    expect(res.body.data.statuses[2]).toMatchObject({ status: "CONFIRMED", count: 3, value: 18000 });
  });

  it("allows warehouse manager to access reports", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(qr([{ total_count: 0, confirmed_count: 0, confirmed_value: null, open_value: null }]))
      .mockResolvedValueOnce(qr([{ total_count: 0, invoiced: null, collected: null, outstanding: null, overdue_count: 0 }]))
      .mockResolvedValueOnce(qr([{ orders_total: 0, partial_count: 0, units_backordered: 0 }]))
      .mockResolvedValueOnce(qr([{ active_count: 0, mrr: null }]))
      .mockResolvedValueOnce(qr([]))
      .mockResolvedValueOnce(qr([{ currency_code: "USD" }]));
    const res = await request(app).get("/api/v1/reports/overview").set("Authorization", `Bearer ${warehouseToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.fulfillment.orders_total).toBe(0);
  });

  it("defaults period to last 12 months when from/to are omitted", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(qr([]))
      .mockResolvedValueOnce(qr([]))
      .mockResolvedValueOnce(qr([]));
    const res = await request(app).get("/api/v1/reports/revenue").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.months.length).toBeGreaterThanOrEqual(12);
  });
});
