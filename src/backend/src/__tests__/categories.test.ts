import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import express from "express";
import request from "supertest";
import { categoriesRouter } from "../modules/categories/categories.routes.js";
import { errorHandler } from "../middleware/errorHandler.js";
import * as db from "../database/pool.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-min-16-chars";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/categories", categoriesRouter);
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

const mockCategory = {
  id: 1, name: "Hardware", description: "Physical products", parent_id: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
};

describe("Categories routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /", () => {
    it("should require authentication", async () => {
      const res = await request(app).get("/api/v1/categories");
      expect(res.status).toBe(401);
    });

    it("should return paginated categories", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ count: "2" }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [mockCategory], rowCount: 1, command: "", oid: 0, fields: [] });

      const res = await request(app)
        .get("/api/v1/categories")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(2);
    });

    it("should accept sales rep", async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ count: "0" }], rowCount: 1, command: "", oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: "", oid: 0, fields: [] });

      const res = await request(app)
        .get("/api/v1/categories")
        .set("Authorization", `Bearer ${repToken()}`);

      expect(res.status).toBe(200);
    });
  });

  describe("GET /:id", () => {
    it("should return a category", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockCategory],
        rowCount: 1,
        command: "",
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .get("/api/v1/categories/1")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Hardware");
    });

    it("should return 404 for missing category", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: "",
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .get("/api/v1/categories/999")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(res.status).toBe(404);
    });
  });

  describe("POST /", () => {
    it("should create a category", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 2, name: "Services", description: "Service offerings", parent_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
        rowCount: 1,
        command: "",
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .post("/api/v1/categories")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ name: "Services", description: "Service offerings" });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe("Services");
    });

    it("should reject empty name", async () => {
      const res = await request(app)
        .post("/api/v1/categories")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ name: "" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("should require admin role", async () => {
      const res = await request(app)
        .post("/api/v1/categories")
        .set("Authorization", `Bearer ${repToken()}`)
        .send({ name: "Test" });

      expect(res.status).toBe(403);
    });
  });

  describe("PATCH /:id", () => {
    it("should update a category", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ ...mockCategory, name: "Updated Hardware" }],
        rowCount: 1,
        command: "",
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .patch("/api/v1/categories/1")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ name: "Updated Hardware" });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Updated Hardware");
    });

    it("should return 404 for missing category", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: "",
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .patch("/api/v1/categories/999")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ name: "X" });

      expect(res.status).toBe(404);
    });
  });
});
