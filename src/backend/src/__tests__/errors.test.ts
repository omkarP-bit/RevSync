import { describe, it, expect } from "vitest";
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  ValidationError,
} from "../shared/errors.js";

describe("AppError", () => {
  it("should create an error with all properties", () => {
    const err = new AppError(400, "BAD_REQUEST", "Something bad", [{ detail: "x" }]);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe("Something bad");
    expect(err.details).toEqual([{ detail: "x" }]);
    expect(err.name).toBe("AppError");
  });

  it("should default details to empty array", () => {
    const err = new AppError(500, "INTERNAL", "oops");
    expect(err.details).toEqual([]);
  });
});

describe("NotFoundError", () => {
  it("should format message with id", () => {
    const err = new NotFoundError("Customer", 42);
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("Customer with id 42 not found");
  });

  it("should format message without id", () => {
    const err = new NotFoundError("Product");
    expect(err.message).toBe("Product not found");
  });

  it("should handle string ids", () => {
    const err = new NotFoundError("User", "abc-123");
    expect(err.message).toBe("User with id abc-123 not found");
  });
});

describe("UnauthorizedError", () => {
  it("should use default message", () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("UNAUTHORIZED");
    expect(err.message).toBe("Unauthorized");
  });

  it("should accept custom message", () => {
    const err = new UnauthorizedError("Token expired");
    expect(err.message).toBe("Token expired");
  });
});

describe("ForbiddenError", () => {
  it("should use default message", () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe("Forbidden");
  });

  it("should accept custom message", () => {
    const err = new ForbiddenError("Need admin role");
    expect(err.message).toBe("Need admin role");
  });
});

describe("ConflictError", () => {
  it("should set properties correctly", () => {
    const err = new ConflictError("Duplicate email");
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toBe("Duplicate email");
  });
});

describe("ValidationError", () => {
  it("should set properties correctly", () => {
    const err = new ValidationError("Invalid input", [{ field: "email" }]);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("Invalid input");
    expect(err.details).toEqual([{ field: "email" }]);
  });

  it("should default details to empty array", () => {
    const err = new ValidationError("Bad data");
    expect(err.details).toEqual([]);
  });
});
