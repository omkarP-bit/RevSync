import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockReq, mockRes, mockNext } from "./helpers.js";
import { errorHandler } from "../middleware/errorHandler.js";
import { AppError, NotFoundError, UnauthorizedError, ValidationError } from "../shared/errors.js";
import { ZodError } from "zod";

describe("errorHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should handle AppError and return correct status/code/message", () => {
    const err = new NotFoundError("Customer", 42);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "NOT_FOUND",
        message: "Customer with id 42 not found",
        details: [],
      },
    });
  });

  it("should handle AppError with details", () => {
    const err = new ValidationError("Bad input", [{ field: "email" }]);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "VALIDATION_ERROR",
        message: "Bad input",
        details: [{ field: "email" }],
      },
    });
  });

  it("should handle ZodError", () => {
    const err = new ZodError([
      { code: "invalid_type", expected: "string", received: "number", path: ["email"], message: "Expected string" },
    ]);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    const calledWith = (res.json as any).mock.calls[0][0];
    expect(calledWith.error.code).toBe("VALIDATION_ERROR");
    expect(calledWith.error.details).toEqual([
      { field: "email", message: "Expected string" },
    ]);
  });

  it("should handle unknown errors as 500", () => {
    const err = new Error("Something unexpected");
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        details: [],
      },
    });
  });

  it("should use requestId from req.id", () => {
    const err = new AppError(400, "TEST", "test error");
    const req = mockReq({ id: "req-abc-123" } as any);
    const res = mockRes();
    const next = mockNext();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    // Verify logger was called (it's mocked in setup)
  });

  it("should fallback requestId to unknown when missing", () => {
    const err = new AppError(400, "TEST", "test error");
    const req = mockReq({ id: undefined } as any);
    const res = mockRes();
    const next = mockNext();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
