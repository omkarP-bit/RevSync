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

function adminToken() {
  return jwt.sign({ userId: 1, roleId: 5, email: "admin@test.com" }, JWT_SECRET, { expiresIn: "1h" });
}

function repToken() {
  return jwt.sign({ userId: 2, roleId: 1, email: "rep@test.com" }, JWT_SECRET, { expiresIn: "1h" });
}

const mockCustomer = {
  id: 1, name: "Acme Corp", email: "acme@test.com", company: "Acme Inc",
  phone: "+1234567890", status: "ACTIVE", currency_code: "USD",
  tier_id: 1, tier_name: "Bronze", created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("Customers routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /", () => {
    it("should require authentication", async () => {
      const res = await request(app).get("/api/v1/customers");
      expect(res.status).toBe(401);
    });

    it("should return paginated customers for admin", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ count: "1" }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [mockCustomer], rowCount: 1, command: "", oid: 0, fields: [] });

      const res = await request(app)
        .get("/api/v1/customers")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe("Acme Corp");
      expect(res.body.meta).toHaveProperty("page", 1);
      expect(res.body.meta).toHaveProperty("limit", 20);
      expect(res.body.meta).toHaveProperty("total", 1);
    });

    it("should support page and limit params", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ count: "50" }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [mockCustomer], rowCount: 1, command: "", oid: 0, fields: [] });

      const res = await request(app)
        .get("/api/v1/customers?page=2&limit=10")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.meta.page).toBe(2);
      expect(res.body.meta.limit).toBe(10);
      expect(res.body.meta.total_pages).toBe(5);
    });

    it("should filter by status", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ count: "1" }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [mockCustomer], rowCount: 1, command: "", oid: 0, fields: [] });

      await request(app)
        .get("/api/v1/customers?status=ACTIVE")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("c.status = $1"),
        expect.arrayContaining(["ACTIVE"])
      );
    });

    it("should return 403 for unauthorized role", async () => {
      const warehouseToken = jwt.sign({ userId: 4, roleId: 4, email: "wh@test.com" }, JWT_SECRET, { expiresIn: "1h" });
      const res = await request(app)
        .get("/api/v1/customers")
        .set("Authorization", `Bearer ${warehouseToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe("GET /:id", () => {
    it("should return a single customer", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockCustomer],
        rowCount: 1,
        command: "",
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .get("/api/v1/customers/1")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Acme Corp");
    });

    it("should return 404 for non-existent customer", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: "",
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .get("/api/v1/customers/999")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(res.status).toBe(404);
    });
  });

  describe("POST /", () => {
    it("should create a new customer", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 2, name: "New Corp", email: "new@test.com", company: null, phone: null, status: "ACTIVE", currency_code: "USD", tier_id: 1, tier_name: "Bronze", created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
        rowCount: 1,
        command: "",
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .post("/api/v1/customers")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ name: "New Corp", email: "new@test.com", tier_id: 1 });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe("New Corp");
    });

    it("should reject invalid body (missing required fields)", async () => {
      const res = await request(app)
        .post("/api/v1/customers")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ name: "" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("should require admin role", async () => {
      const res = await request(app)
        .post("/api/v1/customers")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ name: "Test", email: "test@test.com", tier_id: 1 });

      expect(res.status).toBe(403);
    });
  });

  describe("PATCH /:id", () => {
    it("should update a customer", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ ...mockCustomer, name: "Updated Corp" }],
        rowCount: 1,
        command: "",
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .patch("/api/v1/customers/1")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ name: "Updated Corp" });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Updated Corp");
    });

    it("should return 404 for non-existent customer", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: "",
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .patch("/api/v1/customers/999")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ name: "Updated" });

      expect(res.status).toBe(404);
    });
  });

  describe("Sales Rep can list but not create", () => {
    it("sales rep can GET /", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ count: "0" }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: "", oid: 0, fields: [] });

      const res = await request(app)
        .get("/api/v1/customers")
        .set("Authorization", `Bearer ${repToken()}`);

      expect(res.status).toBe(200);
    });

    it("sales rep cannot POST", async () => {
      const res = await request(app)
        .post("/api/v1/customers")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ name: "Test", email: "test@test.com", tier_id: 1 });

      expect(res.status).toBe(403);
    });
  });
});
