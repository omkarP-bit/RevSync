import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import express from "express";
import request from "supertest";
import { dealHealthRouter } from "../modules/deal-health/deal-health.routes.js";
import { errorHandler } from "../middleware/errorHandler.js";
import {
  evaluateDealHealth,
  daysBetween,
  DealHealthInput,
  SignalConfig,
} from "../engines/deal-health-engine.js";
import * as db from "../database/pool.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-min-16-chars";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/deal-health", dealHealthRouter);
  app.use(errorHandler);
  return app;
}

const app = createApp();

const repToken = () => jwt.sign({ userId: 3, roleId: 1, email: "rep@test.com" }, JWT_SECRET, { expiresIn: "1h" });
const managerToken = () => jwt.sign({ userId: 2, roleId: 2, email: "manager@test.com" }, JWT_SECRET, { expiresIn: "1h" });
const financeToken = () => jwt.sign({ userId: 4, roleId: 3, email: "finance@test.com" }, JWT_SECRET, { expiresIn: "1h" });
const adminToken = () => jwt.sign({ userId: 1, roleId: 5, email: "admin@test.com" }, JWT_SECRET, { expiresIn: "1h" });
const salesToken = () => jwt.sign({ userId: 6, roleId: 1, email: "sales@test.com" }, JWT_SECRET, { expiresIn: "1h" });

const qr = (rows: any[] = []) => ({ rows, rowCount: rows.length, command: "", oid: 0, fields: [] });

function defaultConfigs(): SignalConfig[] {
  return [
    { key: "STALLED_QUOTE", weight: 30, enabled: true },
    { key: "APPROVAL_DELAY", weight: 25, enabled: true },
    { key: "INVENTORY_SHORTAGE", weight: 20, enabled: true },
    { key: "HIGH_DISCOUNT_RISK", weight: 15, enabled: true },
    { key: "NEGOTIATION_STALL", weight: 10, enabled: true },
  ];
}

function healthyInput(overrides: Partial<DealHealthInput> = {}): DealHealthInput {
  const now = new Date("2026-01-31T00:00:00Z");
  return {
    quotationStatus: "DRAFT",
    riskLevel: "LOW",
    marginPct: 35,
    lastUpdatedAt: new Date("2026-01-30T00:00:00Z"),
    pendingApprovalSince: null,
    backorderedQuantity: 0,
    requestedQuantity: 10,
    openNegotiationSince: null,
    now,
    ...overrides,
  };
}

describe("Deal Health Engine", () => {
  it("computes daysBetween as non-negative whole days", () => {
    expect(daysBetween(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-16T00:00:00Z"))).toBe(15);
    expect(daysBetween(new Date("2026-01-16T00:00:00Z"), new Date("2026-01-01T00:00:00Z"))).toBe(0);
  });

  it("scores a fresh deal as HEALTHY with zero contribution", () => {
    const result = evaluateDealHealth(healthyInput(), defaultConfigs());
    expect(result.status).toBe("HEALTHY");
    expect(result.score).toBe(0);
    expect(result.signals).toHaveLength(5);
    expect(result.signals.every((s) => s.severity === 0)).toBe(true);
  });

  it("marks a long-stalled open quotation AT_RISK", () => {
    const result = evaluateDealHealth(
      healthyInput({
        quotationStatus: "DRAFT",
        lastUpdatedAt: new Date("2026-01-05T00:00:00Z"),
      }),
      defaultConfigs()
    );
    expect(result.score).toBe(30);
    expect(result.status).toBe("AT_RISK");
    const stall = result.signals.find((s) => s.key === "STALLED_QUOTE")!;
    expect(stall.severity).toBe(1);
    expect(stall.contribution).toBe(30);
  });

  it("does not penalise terminal quotations for stall", () => {
    const result = evaluateDealHealth(
      healthyInput({ quotationStatus: "CONFIRMED", lastUpdatedAt: new Date("2025-10-01T00:00:00Z") }),
      defaultConfigs()
    );
    const stall = result.signals.find((s) => s.key === "STALLED_QUOTE")!;
    expect(stall.severity).toBe(0);
    expect(stall.reason).toContain("terminal");
  });

  it("scales approval delay severity with waiting time", () => {
    const result = evaluateDealHealth(
      healthyInput({ pendingApprovalSince: new Date("2026-01-27T00:00:00Z") }),
      defaultConfigs()
    );
    // 4 days waiting: ramp(4, 2, 7) = (4-2)/5 = 0.4; contribution 25 * 0.4 = 10
    const approval = result.signals.find((s) => s.key === "APPROVAL_DELAY")!;
    expect(approval.severity).toBeCloseTo(0.4, 2);
    expect(approval.contribution).toBeCloseTo(10, 2);
  });

  it("flags inventory shortage proportional to backorder", () => {
    const result = evaluateDealHealth(
      healthyInput({ backorderedQuantity: 5, requestedQuantity: 10 }),
      defaultConfigs()
    );
    const shortage = result.signals.find((s) => s.key === "INVENTORY_SHORTAGE")!;
    expect(shortage.severity).toBe(0.5);
    expect(shortage.reason).toContain("5");
  });

  it("flags HIGH risk and low margin on the discount signal", () => {
    const highRisk = evaluateDealHealth(healthyInput({ riskLevel: "HIGH" }), defaultConfigs());
    const high = highRisk.signals.find((s) => s.key === "HIGH_DISCOUNT_RISK")!;
    expect(high.severity).toBe(1);
    expect(high.reason).toContain("HIGH");

    const lowMargin = evaluateDealHealth(healthyInput({ riskLevel: "LOW", marginPct: 8 }), defaultConfigs());
    const margin = lowMargin.signals.find((s) => s.key === "HIGH_DISCOUNT_RISK")!;
    expect(margin.severity).toBe(0.75);
    expect(margin.reason).toContain("8.00%");
  });

  it("scores a fully degraded deal CRITICAL", () => {
    const result = evaluateDealHealth(
      healthyInput({
        quotationStatus: "PENDING_APPROVAL",
        riskLevel: "HIGH",
        marginPct: 5,
        lastUpdatedAt: new Date("2025-12-01T00:00:00Z"),
        pendingApprovalSince: new Date("2025-12-01T00:00:00Z"),
        backorderedQuantity: 10,
        requestedQuantity: 10,
        openNegotiationSince: new Date("2025-12-01T00:00:00Z"),
      }),
      defaultConfigs()
    );
    expect(result.score).toBe(100);
    expect(result.status).toBe("CRITICAL");
    expect(result.signals.every((s) => s.severity === 1)).toBe(true);
  });

  it("excludes disabled signals from scoring", () => {
    const configs = defaultConfigs().map((c) => (c.key === "HIGH_DISCOUNT_RISK" ? { ...c, enabled: false } : c));
    const result = evaluateDealHealth(healthyInput({ riskLevel: "HIGH", marginPct: 5 }), configs);
    expect(result.score).toBe(0);
    const high = result.signals.find((s) => s.key === "HIGH_DISCOUNT_RISK")!;
    expect(high.enabled).toBe(false);
    expect(high.contribution).toBe(0);
  });

  it("reports an explainable reason per signal", () => {
    const result = evaluateDealHealth(healthyInput(), defaultConfigs());
    for (const signal of result.signals) {
      expect(typeof signal.reason).toBe("string");
      expect(signal.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("Deal Health routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.query).mockReset();
  });

  it("requires auth", async () => {
    const res = await request(app).get("/api/v1/deal-health");
    expect(res.status).toBe(401);
  });

  it("blocks sales rep from reading signal config", async () => {
    const res = await request(app).get("/api/v1/deal-health/config").set("Authorization", `Bearer ${repToken()}`);
    expect(res.status).toBe(403);
  });

  it("returns signal config for manager", async () => {
    vi.mocked(db.query).mockResolvedValueOnce(
      qr([
        { signal_key: "STALLED_QUOTE", name: "Stalled quote", description: "x", weight: "30.00", is_enabled: true, updated_at: new Date().toISOString() },
      ])
    );
    const res = await request(app).get("/api/v1/deal-health/config").set("Authorization", `Bearer ${managerToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ key: "STALLED_QUOTE", weight: 30, is_enabled: true });
  });

  it("updates a signal weight and writes audit log", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(qr([{ signal_key: "STALLED_QUOTE", name: "Stalled quote", weight: "40.00", is_enabled: true }]))
      .mockResolvedValueOnce(qr());
    const res = await request(app)
      .patch("/api/v1/deal-health/config/STALLED_QUOTE")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ weight: 40 });
    expect(res.status).toBe(200);
    expect(res.body.data.weight).toBe(40);
  });

  it("rejects unknown signal keys on config update", async () => {
    const res = await request(app)
      .patch("/api/v1/deal-health/config/UNKNOWN")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ weight: 40 });
    expect(res.status).toBe(400);
  });

  it("refreshes snapshots and returns status counts", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(qr(defaultConfigs().map((c) => ({ signal_key: c.key, weight: c.weight.toFixed(2), is_enabled: c.enabled }))))
      .mockResolvedValueOnce(
        qr([
          {
            quotation_id: "1",
            status: "DRAFT",
            risk_level: "LOW",
            margin_pct: "35.00",
            updated_at: new Date("2026-01-30T00:00:00Z").toISOString(),
            customer_id: "2",
            sales_rep_id: "3",
            pending_since: null,
            backordered_qty: 0,
            requested_qty: 10,
            open_negotiation_since: null,
          },
        ])
      )
      .mockResolvedValueOnce(qr([]))
      .mockResolvedValueOnce(qr()) // audit log insert
      .mockResolvedValueOnce(qr([{ status: "HEALTHY", count: 1 }]));

    const res = await request(app).post("/api/v1/deal-health/refresh").set("Authorization", `Bearer ${managerToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.refreshed).toBe(1);
    expect(res.body.data.counts).toEqual({ HEALTHY: 1, AT_RISK: 0, CRITICAL: 0 });
  });

  it("lists snapshots with pagination", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce(qr([{ count: "1" }]))
      .mockResolvedValueOnce(
        qr([
          {
            id: "5",
            quotation_id: "1",
            quotation_number: "QT-2026-0001",
            customer_name: "Acme",
            sales_rep_email: "rep@test.com",
            status: "AT_RISK",
            score: "30.00",
            computed_at: new Date().toISOString(),
          },
        ])
      );
    const res = await request(app)
      .get("/api/v1/deal-health")
      .set("Authorization", `Bearer ${financeToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0].status).toBe("AT_RISK");
  });

  it("returns overview counts", async () => {
    vi.mocked(db.query).mockResolvedValueOnce(
      qr([
        { status: "HEALTHY", count: 4, avg_score: "5.00" },
        { status: "AT_RISK", count: 1, avg_score: "40.00" },
      ])
    );
    const res = await request(app).get("/api/v1/deal-health/overview").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.counts).toEqual({ HEALTHY: 4, AT_RISK: 1, CRITICAL: 0 });
    expect(res.body.data.total).toBe(5);
    expect(res.body.data.avg_score).toBe(12);
  });

  it("returns a snapshot detail with signal breakdown", async () => {
    const signals = evaluateDealHealth(healthyInput(), defaultConfigs()).signals;
    vi.mocked(db.query).mockResolvedValueOnce(
      qr([
        {
          id: "5",
          public_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
          quotation_id: "1",
          customer_id: "2",
          sales_rep_id: "3",
          status: "HEALTHY",
          score: "0.00",
          signals,
          computed_at: new Date().toISOString(),
          quotation_number: "QT-2026-0001",
          customer_name: "Acme",
          sales_rep_email: "rep@test.com",
        },
      ])
    );
    const res = await request(app).get("/api/v1/deal-health/5").set("Authorization", `Bearer ${salesToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.signals).toHaveLength(5);
  });

  it("returns 404 for a missing snapshot", async () => {
    vi.mocked(db.query).mockResolvedValueOnce(qr([]));
    const res = await request(app).get("/api/v1/deal-health/999").set("Authorization", `Bearer ${managerToken()}`);
    expect(res.status).toBe(404);
  });
});