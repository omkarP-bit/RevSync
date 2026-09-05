import { describe, it, expect, vi } from "vitest";
import { mockReq, mockRes, mockNext } from "./helpers.js";
import { requestLogger } from "../middleware/requestLogger.js";

describe("requestLogger middleware", () => {
  it("should call next()", () => {
    const req = mockReq({ method: "GET", originalUrl: "/test" });
    const res = mockRes();
    const next = mockNext();

    requestLogger(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("should register a finish listener on res", () => {
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    requestLogger(req, res, next);

    expect(res.on).toHaveBeenCalledWith("finish", expect.any(Function));
  });
});
