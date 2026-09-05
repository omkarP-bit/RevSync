import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { healthRouter } from "../modules/health/health.routes.js";

const app = express();
app.use("/api/v1", healthRouter);

describe("Health endpoint", () => {
  it("GET /api/v1/health should return 200 with status ok", async () => {
    const res = await request(app).get("/api/v1/health");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "ok");
    expect(res.body).toHaveProperty("timestamp");
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });
});
