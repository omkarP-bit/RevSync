import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import { mockReq, mockRes, mockNext } from "./helpers.js";
import { authenticate, requireRole, ROLES } from "../middleware/auth.js";
import { UnauthorizedError, ForbiddenError } from "../shared/errors.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-min-16-chars";

describe("authenticate middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should reject request without Authorization header", () => {
    const req = mockReq({ headers: {} });
    const res = mockRes();
    const next = mockNext();

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it("should reject request with non-Bearer token", () => {
    const req = mockReq({ headers: { authorization: "Basic abc123" } });
    const res = mockRes();
    const next = mockNext();

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it("should reject invalid token", () => {
    const req = mockReq({ headers: { authorization: "Bearer invalid-token" } });
    const res = mockRes();
    const next = mockNext();

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it("should accept valid token and attach user to req", () => {
    const payload = { userId: 1, roleId: 5, email: "admin@test.com" };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });

    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    const next = mockNext();

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect((req as any).user).toBeDefined();
    expect((req as any).user.userId).toBe(1);
    expect((req as any).user.roleId).toBe(5);
    expect((req as any).user.email).toBe("admin@test.com");
  });

  it("should reject expired token", () => {
    const payload = { userId: 1, roleId: 5, email: "admin@test.com" };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "-1h" });

    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    const next = mockNext();

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });
});

describe("requireRole middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should reject if user is not set (unauthenticated)", () => {
    const req = mockReq({});
    const res = mockRes();
    const next = mockNext();

    const middleware = requireRole(ROLES.ADMIN);
    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it("should reject if user role is not in allowed roles", () => {
    const req = mockReq({ user: { userId: 1, roleId: ROLES.SALES_REP, email: "rep@test.com" } } as any);
    const res = mockRes();
    const next = mockNext();

    const middleware = requireRole(ROLES.ADMIN, ROLES.FINANCE);
    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  it("should pass if user role is in allowed roles", () => {
    const req = mockReq({ user: { userId: 1, roleId: ROLES.ADMIN, email: "admin@test.com" } } as any);
    const res = mockRes();
    const next = mockNext();

    const middleware = requireRole(ROLES.ADMIN, ROLES.FINANCE);
    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("should pass with no role restrictions when array is empty", () => {
    const req = mockReq({ user: { userId: 1, roleId: ROLES.SALES_REP, email: "rep@test.com" } } as any);
    const res = mockRes();
    const next = mockNext();

    const middleware = requireRole();
    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });
});

describe("ROLES constants", () => {
  it("should define all 5 roles", () => {
    expect(ROLES.SALES_REP).toBe(1);
    expect(ROLES.SALES_MANAGER).toBe(2);
    expect(ROLES.FINANCE).toBe(3);
    expect(ROLES.WAREHOUSE_MANAGER).toBe(4);
    expect(ROLES.ADMIN).toBe(5);
  });
});
