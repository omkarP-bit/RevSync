import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import express from "express";
import request from "supertest";
import { approvalsRouter } from "../modules/approvals/approvals.routes.js";
import { errorHandler } from "../middleware/errorHandler.js";
import * as db from "../database/pool.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-min-16-chars";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/approvals", approvalsRouter);
  app.use(errorHandler);
  return app;
}

const app = createApp();

function token(roleId: number, userId = 3) {
  return jwt.sign({ userId, roleId, email: "u@test.com" }, JWT_SECRET, { expiresIn: "1h" });
}

const managerToken = token(2);
const financeToken = token(3);
const repToken = token(1);

const emptyResult = { rows: [], rowCount: 0, command: "", oid: 0, fields: [] };
const oneRow = (rows: any[]) => ({ rows, rowCount: rows.length, command: "", oid: 0, fields: [] });

const requestRow = {
  id: "1",
  quotation_id: "7",
  quotation_number: "QT-2026-0007",
  customer_name: "Acme Corp",
  currency_code: "USD",
  grand_total: "1190.0000",
  status: "PENDING_APPROVAL",
  risk_level: "HIGH",
  total_overage: "9.0000",
  submitted_by: "3",
  submitted_by_name: "Alex Salesrep",
  submitted_at: new Date().toISOString(),
  decided_by: null,
  decided_by_name: null,
  decided_at: null,
  notes: null,
};

const stepRow = {
  id: "10",
  approval_request_id: "1",
  sequence: 1,
  role_id: "2",
  role_name: "Sales Manager",
  status: "PENDING",
  decided_by: null,
  decided_by_name: null,
  decided_at: null,
  notes: null,
};

const highRuleRow = {
  id: "2",
  risk_level: "HIGH",
  min_total_overage: "8.0000",
  role_sequence: [2, 3],
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("Approvals routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/v1/approvals", () => {
    it("requires authentication", async () => {
      const res = await request(app).get("/api/v1/approvals");
      expect(res.status).toBe(401);
    });

    it("allows Sales Reps, Managers, Finance, and Admins to view approvals", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(oneRow([{ count: "1" }]))
        .mockResolvedValueOnce(oneRow([requestRow]))
        .mockResolvedValueOnce(oneRow([stepRow]));

      const res = await request(app)
        .get("/api/v1/approvals")
        .set("Authorization", `Bearer ${repToken}`);
      expect(res.status).toBe(200);
    });

    it("returns paginated approval requests newest-first queue", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(oneRow([{ count: "1" }]))
        .mockResolvedValueOnce(oneRow([requestRow]))
        .mockResolvedValueOnce(oneRow([stepRow]));

      const res = await request(app)
        .get("/api/v1/approvals")
        .set("Authorization", `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].current_step.sequence).toBe(1);
      expect(res.body.data[0].current_step.role_name).toBe("Sales Manager");
      expect(res.body.meta.total).toBe(1);
    });
  });

  describe("GET /api/v1/approvals/:id", () => {
    it("returns the request with its steps", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(oneRow([requestRow]))
        .mockResolvedValueOnce(oneRow([stepRow, { ...stepRow, id: "11", sequence: 2, role_id: "3", role_name: "Finance" }]));

      const res = await request(app)
        .get("/api/v1/approvals/1")
        .set("Authorization", `Bearer ${financeToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.steps).toHaveLength(2);
      expect(res.body.data.steps[0].role_id).toBe(2);
      expect(res.body.data.steps[1].role_id).toBe(3);
    });

    it("returns 404 for an unknown request", async () => {
      vi.mocked(db.query).mockResolvedValueOnce(emptyResult);

      const res = await request(app)
        .get("/api/v1/approvals/999")
        .set("Authorization", `Bearer ${financeToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/v1/approvals/rules", () => {
    it("returns approval rules for a Sales Manager", async () => {
      vi.mocked(db.query).mockResolvedValueOnce(oneRow([highRuleRow]));

      const res = await request(app)
        .get("/api/v1/approvals/rules")
        .set("Authorization", `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0].risk_level).toBe("HIGH");
      expect(res.body.data[0].role_sequence).toEqual([2, 3]);
    });

    it("restricts rule access from a Sales Rep", async () => {
      const res = await request(app)
        .get("/api/v1/approvals/rules")
        .set("Authorization", `Bearer ${repToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe("approve / reject / return", () => {
    const pendingSteps = () => oneRow([
      { id: "10", sequence: 1, role_id: "2", status: "PENDING" },
      { id: "11", sequence: 2, role_id: "3", status: "PENDING" },
    ]);

    it("approves the current step and stays pending while more steps remain", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(oneRow([{ id: "1", quotation_id: "7", status: "PENDING_APPROVAL", risk_level: "HIGH" }]))
        .mockResolvedValueOnce(pendingSteps())
        .mockResolvedValueOnce(oneRow([{ id: "10", status: "APPROVED" }]))
        .mockResolvedValueOnce(oneRow([{ id: "1", status: "PENDING_APPROVAL" }]))
        .mockResolvedValueOnce(oneRow([{ id: 1 }])); // audit

      const res = await request(app)
        .post("/api/v1/approvals/1/approve")
        .set("Authorization", `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("PENDING_APPROVAL");
      expect(res.body.data.quotation_status).toBeNull();
    });

    it("blocks a role from deciding out of turn", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(oneRow([{ id: "1", quotation_id: "7", status: "PENDING_APPROVAL", risk_level: "HIGH" }]))
        .mockResolvedValueOnce(pendingSteps());

      const res = await request(app)
        .post("/api/v1/approvals/1/approve")
        .set("Authorization", `Bearer ${financeToken}`);

      expect(res.status).toBe(403);
    });

    it("completes the workflow and approves the quotation on the final step", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(oneRow([{ id: "1", quotation_id: "7", status: "PENDING_APPROVAL", risk_level: "HIGH" }]))
        .mockResolvedValueOnce(oneRow([
          { id: "10", sequence: 1, role_id: "2", status: "APPROVED" },
          { id: "11", sequence: 2, role_id: "3", status: "PENDING" },
        ]))
        .mockResolvedValueOnce(oneRow([{ id: "11", status: "APPROVED" }]))
        .mockResolvedValueOnce(oneRow([{ id: "1", status: "APPROVED" }]))
        .mockResolvedValueOnce(oneRow([{ id: "7", status: "APPROVED" }])) // quotation status update
        .mockResolvedValueOnce(oneRow([{ id: 1 }])); // audit

      const res = await request(app)
        .post("/api/v1/approvals/1/approve")
        .set("Authorization", `Bearer ${financeToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("APPROVED");
      expect(res.body.data.quotation_status).toBe("APPROVED");
    });

    it("rejects the request and the quotation", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(oneRow([{ id: "1", quotation_id: "7", status: "PENDING_APPROVAL", risk_level: "HIGH" }]))
        .mockResolvedValueOnce(pendingSteps())
        .mockResolvedValueOnce(oneRow([{ id: "10", status: "REJECTED" }]))
        .mockResolvedValueOnce(oneRow([{ id: "1", status: "REJECTED" }]))
        .mockResolvedValueOnce(oneRow([{ id: "7", status: "REJECTED" }]))
        .mockResolvedValueOnce(oneRow([{ id: 1 }])); // audit

      const res = await request(app)
        .post("/api/v1/approvals/1/reject")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ notes: "Too aggressive" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("REJECTED");
      expect(res.body.data.quotation_status).toBe("REJECTED");
    });

    it("returns the request to negotiation", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(oneRow([{ id: "1", quotation_id: "7", status: "PENDING_APPROVAL", risk_level: "HIGH" }]))
        .mockResolvedValueOnce(pendingSteps())
        .mockResolvedValueOnce(oneRow([{ id: "10", status: "SKIPPED" }]))
        .mockResolvedValueOnce(oneRow([{ id: "1", status: "RETURNED" }]))
        .mockResolvedValueOnce(oneRow([{ id: "7", status: "NEGOTIATION" }]))
        .mockResolvedValueOnce(oneRow([{ id: 1 }])); // audit

      const res = await request(app)
        .post("/api/v1/approvals/1/return")
        .set("Authorization", `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("RETURNED");
      expect(res.body.data.quotation_status).toBe("NEGOTIATION");
    });

    it("rejects a decision on an already-decided request", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce(oneRow([{ id: "1", quotation_id: "7", status: "APPROVED", risk_level: "HIGH" }]));

      const res = await request(app)
        .post("/api/v1/approvals/1/approve")
        .set("Authorization", `Bearer ${managerToken}`);

      expect(res.status).toBe(422);
    });
  });

  describe("POST /api/v1/approvals/rules", () => {
    it("creates an approval rule as Admin", async () => {
      vi.mocked(db.query).mockResolvedValueOnce(oneRow([highRuleRow]));

      const res = await request(app)
        .post("/api/v1/approvals/rules")
        .set("Authorization", `Bearer ${token(5)}`)
        .send({ risk_level: "HIGH", min_total_overage: 8, role_sequence: [2, 3] });

      expect(res.status).toBe(201);
      expect(res.body.data.risk_level).toBe("HIGH");
    });

    it("restricts rule creation to Admin", async () => {
      const res = await request(app)
        .post("/api/v1/approvals/rules")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ risk_level: "HIGH", min_total_overage: 8, role_sequence: [2, 3] });
      expect(res.status).toBe(403);
    });
  });
});