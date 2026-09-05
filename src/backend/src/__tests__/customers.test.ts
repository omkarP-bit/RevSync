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
    it("should create a new customer for admin", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ customer_type: "STANDARD", min_po_value: "0", min_upfront_payment_pct: "0" }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ id: 2 }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({
          rows: [{ id: 2, name: "New Corp", email: "new@test.com", company: "New Inc", phone: "+123", status: "ACTIVE", currency_code: "USD", tier_id: 1, tier_name: "Bronze", credit_limit: "5000.00", billing_address: "123 Main St", shipping_address: "123 Main St", created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
          rowCount: 1, command: "", oid: 0, fields: [],
        })
        .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1, command: "", oid: 0, fields: [] });

      const res = await request(app)
        .post("/api/v1/customers")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({
          name: "New Corp",
          email: "new@test.com",
          company: "New Inc",
          phone: "+123",
          tier_id: 1,
          credit_limit: 5000,
          billing_address: "123 Main St",
          shipping_address: "123 Main St",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe("New Corp");
      expect(res.body.data.tier_name).toBe("Bronze");
      expect(res.body.data.credit_limit).toBe("5000.00");
    });

    it("should allow sales rep to create customer", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ customer_type: "STANDARD", min_po_value: "0", min_upfront_payment_pct: "0" }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ id: 3 }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({
          rows: [{ id: 3, name: "Rep Corp", email: "repcorp@test.com", tier_id: 1, tier_name: "Bronze", status: "ACTIVE", currency_code: "USD" }],
          rowCount: 1, command: "", oid: 0, fields: [],
        })
        .mockResolvedValueOnce({ rows: [{ id: 2 }], rowCount: 1, command: "", oid: 0, fields: [] });

      const res = await request(app)
        .post("/api/v1/customers")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ name: "Rep Corp", email: "repcorp@test.com", tier_id: 1 });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe("Rep Corp");
    });

    it("should forbid sales rep from setting credit_limit on creation", async () => {
      const res = await request(app)
        .post("/api/v1/customers")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ name: "Rep Corp", email: "repcorp2@test.com", credit_limit: 5000 });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("should reject duplicate email with 409 Conflict", async () => {
      const err = new Error("duplicate key value violates unique constraint") as any;
      err.code = "23505";
      err.constraint = "customers_email_key";
      vi.mocked(db.query).mockRejectedValueOnce(err);

      const res = await request(app)
        .post("/api/v1/customers")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ name: "Dup Corp", email: "existing@test.com", tier_id: 1 });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONFLICT");
    });

    it("should reject invalid body (missing required fields / negative credit limit)", async () => {
      const res = await request(app)
        .post("/api/v1/customers")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ name: "Invalid", email: "invalid@test.com", tier_id: 1, credit_limit: -100 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("should forbid customer / warehouse role from creating customer", async () => {
      const whToken = jwt.sign({ userId: 4, roleId: 4, email: "wh@test.com" }, JWT_SECRET, { expiresIn: "1h" });
      const res = await request(app)
        .post("/api/v1/customers")
        .set("Authorization", `Bearer ${whToken}`)
        .send({ name: "Test", email: "test@test.com", tier_id: 1 });

      expect(res.status).toBe(403);
    });
  });

  describe("POST /evaluate-preview", () => {
    it("should return live calculated tier evaluation preview", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [
            { id: 1, name: "Bronze", customer_type: "STANDARD", min_po_value: "0", min_upfront_payment_pct: "0" },
            { id: 3, name: "Gold", customer_type: "ENTERPRISE", min_po_value: "50000", min_upfront_payment_pct: "20" },
          ],
          rowCount: 2, command: "", oid: 0, fields: [],
        });

      const res = await request(app)
        .post("/api/v1/customers/evaluate-preview")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({
          customer_type: "ENTERPRISE",
          expected_po_value: 60000,
          upfront_payment_pct: 30,
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("recommended_tier");
    });
  });

  describe("POST /:id/tier/override", () => {
    it("should allow admin or manager to set tier override", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ id: 1, customer_type: "STANDARD", expected_po_value: "0", upfront_payment_pct: "0", payment_terms: "NET30" }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ id: 3, name: "Gold" }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ id: 10 }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ id: 1, name: "Acme", tier_id: 3, tier_override_id: 3, tier_name: "Gold" }], rowCount: 1, command: "", oid: 0, fields: [] });

      const res = await request(app)
        .post("/api/v1/customers/1/tier/override")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ override_tier_id: 3, reason: "Strategic partner override" });

      expect(res.status).toBe(200);
      expect(res.body.data.resolved_tier).toBe("Gold");
    });

    it("should forbid sales rep from setting tier override", async () => {
      const res = await request(app)
        .post("/api/v1/customers/1/tier/override")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ override_tier_id: 3, reason: "Rep attempt" });

      expect(res.status).toBe(403);
    });
  });

  describe("POST /:id/tier/clear-override", () => {
    it("should allow admin or manager to clear tier override", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ id: 1, tier_override_id: 3, calculated_tier_id: 1, override_tier_name: "Gold", calculated_tier_name: "Bronze" }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ id: 11 }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ id: 1, name: "Acme", tier_id: 1, tier_name: "Bronze", tier_override_id: null }], rowCount: 1, command: "", oid: 0, fields: [] });

      const res = await request(app)
        .post("/api/v1/customers/1/tier/clear-override")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("CONFIRMED");
    });

    it("should forbid sales rep from clearing tier override", async () => {
      const res = await request(app)
        .post("/api/v1/customers/1/tier/clear-override")
        .set("Authorization", `Bearer ${repToken()}`);

      expect(res.status).toBe(403);
    });
  });

  describe("GET /tiers", () => {
    it("should return customer tiers", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          { id: 1, name: "Bronze", description: "Entry-level tier", discount_ceiling_pct: "5.00" },
          { id: 2, name: "Silver", description: "Mid-level tier", discount_ceiling_pct: "10.00" },
          { id: 3, name: "Gold", description: "Premium tier", discount_ceiling_pct: "15.00" },
        ],
        rowCount: 3, command: "", oid: 0, fields: [],
      });

      const res = await request(app)
        .get("/api/v1/customers/tiers")
        .set("Authorization", `Bearer ${repToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data[0].name).toBe("Bronze");
    });
  });

  describe("PATCH /:id", () => {
    it("should update customer for admin", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [mockCustomer], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ ...mockCustomer, name: "Updated Corp" }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1, command: "", oid: 0, fields: [] });

      const res = await request(app)
        .patch("/api/v1/customers/1")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ name: "Updated Corp" });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Updated Corp");
    });

    it("should forbid sales rep from updating commercial controls (tier_id / credit_limit)", async () => {
      const res = await request(app)
        .patch("/api/v1/customers/1")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ tier_id: 3 });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
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

  describe("Sales Rep permissions", () => {
    it("sales rep can GET /", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ count: "0" }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: "", oid: 0, fields: [] });

      const res = await request(app)
        .get("/api/v1/customers")
        .set("Authorization", `Bearer ${repToken()}`);

      expect(res.status).toBe(200);
    });
  });
});
