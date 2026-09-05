import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import express from "express";
import request from "supertest";
import { currenciesRouter } from "../modules/currencies/currencies.routes.js";
import { errorHandler } from "../middleware/errorHandler.js";
import * as db from "../database/pool.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-min-16-chars";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/currencies", currenciesRouter);
  app.use(errorHandler);
  return app;
}

const app = createApp();

function adminToken() {
  return jwt.sign({ userId: 1, roleId: 5, email: "admin@test.com" }, JWT_SECRET, { expiresIn: "1h" });
}

function financeToken() {
  return jwt.sign({ userId: 2, roleId: 3, email: "finance@test.com" }, JWT_SECRET, { expiresIn: "1h" });
}

function repToken() {
  return jwt.sign({ userId: 3, roleId: 1, email: "rep@test.com" }, JWT_SECRET, { expiresIn: "1h" });
}

const mockCurrency = {
  id: 1, code: "USD", name: "US Dollar", symbol: "$", is_active: true,
  created_at: new Date().toISOString(),
};

describe("Currencies routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /", () => {
    it("should require authentication", async () => {
      const res = await request(app).get("/api/v1/currencies");
      expect(res.status).toBe(401);
    });

    it("should return paginated currencies", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ count: "4" }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [mockCurrency], rowCount: 1, command: "", oid: 0, fields: [] });

      const res = await request(app)
        .get("/api/v1/currencies")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(4);
    });

    it("should accept finance role", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ count: "0" }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: "", oid: 0, fields: [] });

      const res = await request(app)
        .get("/api/v1/currencies")
        .set("Authorization", `Bearer ${financeToken()}`);

      expect(res.status).toBe(200);
    });
  });

  describe("POST /", () => {
    it("should create a currency", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 5, code: "JPY", name: "Japanese Yen", symbol: "¥", is_active: true, created_at: new Date().toISOString() }],
        rowCount: 1,
        command: "",
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .post("/api/v1/currencies")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ code: "JPY", name: "Japanese Yen", symbol: "¥" });

      expect(res.status).toBe(201);
      expect(res.body.data.code).toBe("JPY");
    });

    it("should uppercase the currency code", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockCurrency],
        rowCount: 1,
        command: "",
        oid: 0,
        fields: [],
      });

      await request(app)
        .post("/api/v1/currencies")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ code: "eur", name: "Euro", symbol: "€" });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("VALUES ($1"),
        expect.arrayContaining(["EUR"])
      );
    });

    it("should reject non-3-char code", async () => {
      const res = await request(app)
        .post("/api/v1/currencies")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ code: "US", name: "US Dollar", symbol: "$" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("should require admin role", async () => {
      const res = await request(app)
        .post("/api/v1/currencies")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ code: "XYZ", name: "Test", symbol: "T" });

      expect(res.status).toBe(403);
    });
  });

  describe("GET /exchange-rates", () => {
    it("should return exchange rates", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 1, from_currency_code: "USD", to_currency_code: "EUR", rate: 0.92 }],
        rowCount: 1,
        command: "",
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .get("/api/v1/currencies/exchange-rates")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it("should accept finance role", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: "",
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .get("/api/v1/currencies/exchange-rates")
        .set("Authorization", `Bearer ${financeToken()}`);

      expect(res.status).toBe(200);
    });
  });

  describe("POST /exchange-rates", () => {
    it("should create an exchange rate", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 1, from_currency_code: "USD", to_currency_code: "EUR", rate: 0.92 }],
        rowCount: 1,
        command: "",
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .post("/api/v1/currencies/exchange-rates")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ from_currency_code: "USD", to_currency_code: "EUR", rate: 0.92 });

      expect(res.status).toBe(201);
    });

    it("should reject same currency exchange", async () => {
      const res = await request(app)
        .post("/api/v1/currencies/exchange-rates")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ from_currency_code: "USD", to_currency_code: "USD", rate: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("should reject negative rate", async () => {
      const res = await request(app)
        .post("/api/v1/currencies/exchange-rates")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ from_currency_code: "USD", to_currency_code: "EUR", rate: -1 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });
});
