import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import express from "express";
import request from "supertest";
import { authRouter } from "../modules/auth/auth.routes.js";
import { errorHandler } from "../middleware/errorHandler.js";
import * as db from "../database/pool.js";
import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-min-16-chars";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/auth", authRouter);
  app.use(errorHandler);
  return app;
}

const app = createApp();

const mockUser = {
  id: 1,
  email: "admin@test.com",
  password_hash: bcrypt.hashSync("password123", 1),
  role_id: 5,
  role_name: "Admin",
};

describe("Auth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /login", () => {
    it("should return 401 if email is missing", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ password: "password123" });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });

    it("should return 401 if password is missing", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "test@test.com" });

      expect(res.status).toBe(401);
    });

    it("should return 401 for invalid credentials", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0, command: "", oid: 0, fields: [] });

      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "wrong@test.com", password: "password123" });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });

    it("should return 401 for wrong password", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockUser],
        rowCount: 1,
        command: "",
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "admin@test.com", password: "wrongpassword" });

      expect(res.status).toBe(401);
    });

    it("should return tokens on successful login", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockUser],
        rowCount: 1,
        command: "",
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "admin@test.com", password: "password123" });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("access_token");
      expect(res.body.data).toHaveProperty("refresh_token");
      expect(res.body.data.user.email).toBe("admin@test.com");
      expect(res.body.data.user.role_id).toBe(5);
      expect(res.body.data.user.role_name).toBe("Admin");

      // Verify token is valid
      const decoded = jwt.verify(res.body.data.access_token, JWT_SECRET) as any;
      expect(decoded.userId).toBe(1);
      expect(decoded.email).toBe("admin@test.com");
    });

    it("should lowercase email before query", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [mockUser],
        rowCount: 1,
        command: "",
        oid: 0,
        fields: [],
      });

      await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "Admin@Test.COM", password: "password123" });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE u.email = $1"),
        ["admin@test.com"]
      );
    });
  });

  describe("POST /refresh", () => {
    it("should return 401 if refresh_token is missing", async () => {
      const res = await request(app)
        .post("/api/v1/auth/refresh")
        .send({});

      expect(res.status).toBe(401);
    });

    it("should return 401 for invalid refresh token", async () => {
      const res = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refresh_token: "invalid-token" });

      expect(res.status).toBe(401);
    });

    it("should return new tokens on valid refresh", async () => {
      const payload = { userId: 1, roleId: 5, email: "admin@test.com" };
      const refreshToken = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

      const res = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refresh_token: refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("access_token");
      expect(res.body.data).toHaveProperty("refresh_token");

      const decoded = jwt.verify(res.body.data.access_token, JWT_SECRET) as any;
      expect(decoded.userId).toBe(1);
    });
  });

  describe("POST /logout", () => {
    it("should require authentication", async () => {
      const res = await request(app).post("/api/v1/auth/logout");
      expect(res.status).toBe(401);
    });

    it("should return success when authenticated", async () => {
      const payload = { userId: 1, roleId: 5, email: "admin@test.com" };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });

      const res = await request(app)
        .post("/api/v1/auth/logout")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe("Logged out");
    });
  });
});
