import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import express from "express";
import request from "supertest";
import crypto from "crypto";
import bcrypt from "bcryptjs";

import { customerAuthRouter } from "../modules/auth/customerAuth.routes.js";
import { quotationsPortalRouter } from "../modules/quotations/quotationsPortal.routes.js";
import { errorHandler } from "../middleware/errorHandler.js";
import * as db from "../database/pool.js";
import * as quoteWorkflow from "../shared/quote-workflow.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-min-16-chars";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/auth/customer", customerAuthRouter);
  app.use("/api/v1/portal/quotations", quotationsPortalRouter);
  app.use(errorHandler);
  return app;
}

const app = createApp();

function customerToken(customerId = 1, email = "customer@example.com") {
  return jwt.sign(
    { customerId, email, type: "customer" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
}

describe("Customer Authentication & Portal Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/v1/auth/customer/setup-password", () => {
    it("should reject password setup with an invalid setup token", async () => {
      vi.spyOn(db, "query").mockResolvedValueOnce({ rows: [], rowCount: 0, command: "", oid: 0, fields: [] });

      const res = await request(app)
        .post("/api/v1/auth/customer/setup-password")
        .send({ setup_token: "invalid-token", password: "NewPassword123!" });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("Invalid or expired password setup token");
    });

    it("should set password and return authentication token on valid setup token", async () => {
      const rawToken = "st_validtoken123456789012345678901234567890";

      const mockCustomerRow = {
        id: 1,
        name: "Test Customer",
        email: "customer@example.com",
        company: "Test Co",
        status: "ACTIVE",
        currency_code: "USD",
        tier_id: 1,
        tier_name: "Bronze",
        setup_token_expires_at: new Date(Date.now() + 86400000).toISOString(),
      };

      vi.spyOn(db, "query")
        .mockResolvedValueOnce({ rows: [mockCustomerRow], rowCount: 1, command: "", oid: 0, fields: [] }) // select customer by token hash
        .mockResolvedValueOnce({ rows: [], rowCount: 1, command: "", oid: 0, fields: [] }); // update password_hash & null setup_token

      const res = await request(app)
        .post("/api/v1/auth/customer/setup-password")
        .send({ setup_token: rawToken, password: "SecurePassword123!" });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("token");
      expect(res.body.data.customer).toHaveProperty("email", "customer@example.com");
      expect(res.body.data.customer).toHaveProperty("tier_name", "Bronze");
    });
  });

  describe("POST /api/v1/auth/customer/login", () => {
    it("should reject login with wrong password", async () => {
      const hashedPassword = await bcrypt.hash("CorrectPassword123!", 10);
      const mockCustomerRow = {
        id: 1,
        name: "Test Customer",
        email: "customer@example.com",
        company: "Test Co",
        status: "ACTIVE",
        currency_code: "USD",
        tier_name: "Gold",
        password_hash: hashedPassword,
      };

      vi.spyOn(db, "query").mockResolvedValueOnce({ rows: [mockCustomerRow], rowCount: 1, command: "", oid: 0, fields: [] });

      const res = await request(app)
        .post("/api/v1/auth/customer/login")
        .send({ email: "customer@example.com", password: "WrongPassword" });

      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe("Invalid credentials");
    });

    it("should return token and customer metadata on valid login", async () => {
      const hashedPassword = await bcrypt.hash("CorrectPassword123!", 10);
      const mockCustomerRow = {
        id: 1,
        name: "Test Customer",
        email: "customer@example.com",
        company: "Test Co",
        status: "ACTIVE",
        currency_code: "USD",
        tier_name: "Gold",
        password_hash: hashedPassword,
      };

      vi.spyOn(db, "query").mockResolvedValueOnce({ rows: [mockCustomerRow], rowCount: 1, command: "", oid: 0, fields: [] });

      const res = await request(app)
        .post("/api/v1/auth/customer/login")
        .send({ email: "customer@example.com", password: "CorrectPassword123!" });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("token");
      expect(res.body.data.customer.name).toBe("Test Customer");
      expect(res.body.data.customer.tier_name).toBe("Gold");
    });
  });

  describe("GET /api/v1/portal/quotations", () => {
    it("should require customer authentication", async () => {
      const res = await request(app).get("/api/v1/portal/quotations");
      expect(res.status).toBe(401);
    });

    it("should return quotations owned by customer", async () => {
      const token = customerToken(1);

      vi.spyOn(db, "query")
        .mockResolvedValueOnce({ rows: [{ count: "1" }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 10,
              public_id: "q-pub-123",
              quotation_number: "QT-2026-0001",
              currency_code: "USD",
              status: "APPROVED",
              subtotal: 1000,
              discount_total: 0,
              order_discount_pct: 0,
              tax_rate_pct: 10,
              tax_total: 100,
              grand_total: 1100,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
          rowCount: 1,
          command: "",
          oid: 0,
          fields: [],
        });

      const res = await request(app)
        .get("/api/v1/portal/quotations")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].quotation_number).toBe("QT-2026-0001");
    });
  });

  describe("IDOR Protection on GET /api/v1/portal/quotations/:publicId", () => {
    it("should return 404 if quotation belongs to another customer", async () => {
      const token = customerToken(1); // Customer ID 1

      vi.spyOn(db, "query").mockResolvedValueOnce({
        rows: [
          {
            id: 20,
            public_id: "q-pub-999",
            quotation_number: "QT-2026-0099",
            customer_id: 2, // Belongs to Customer ID 2!
            customer_name: "Other Corp",
            currency_code: "USD",
            status: "APPROVED",
            grand_total: 5000,
          },
        ],
        rowCount: 1,
        command: "",
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .get("/api/v1/portal/quotations/q-pub-999")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/v1/portal/quotations/:publicId/confirm", () => {
    it("should execute quotation confirmation for authorized customer", async () => {
      const token = customerToken(1);

      vi.spyOn(db, "query")
        .mockResolvedValueOnce({
          rows: [{ id: 10, customer_id: 1, status: "APPROVED" }],
          rowCount: 1,
          command: "",
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 10,
              public_id: "q-pub-123",
              quotation_number: "QT-2026-0001",
              status: "CONFIRMED",
              currency_code: "USD",
              grand_total: 1100,
              updated_at: new Date().toISOString(),
            },
          ],
          rowCount: 1,
          command: "",
          oid: 0,
          fields: [],
        });

      vi.spyOn(quoteWorkflow, "executeQuotationConfirmation").mockResolvedValue({
        quote: { id: 10, quotation_number: "QT-2026-0001", status: "CONFIRMED" },
        subscriptions: [],
        invoice: null,
        fulfillmentOrder: null,
      } as any);

      const res = await request(app)
        .post("/api/v1/portal/quotations/q-pub-123/confirm")
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("CONFIRMED");
      expect(quoteWorkflow.executeQuotationConfirmation).toHaveBeenCalledWith(
        10,
        null,
        "Confirmed by customer via Customer Portal"
      );
    });
  });
});
