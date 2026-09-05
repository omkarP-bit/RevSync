import { vi } from "vitest";
import type { Request, Response } from "express";

export function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    method: "GET",
    originalUrl: "/",
    id: "test-request-id",
    user: undefined,
    customer: undefined,
    ...overrides,
  } as unknown as Request;
}

export function mockRes(): Response & { _json: any; _status: number } {
  const res = {
    _json: null as any,
    _status: 200,
    status: vi.fn(function (this: any, code: number) {
      this._status = code;
      return this;
    }),
    json: vi.fn(function (this: any, data: any) {
      this._json = data;
      return this;
    }),
    on: vi.fn(),
  } as unknown as Response & { _json: any; _status: number };
  return res;
}

export function mockNext() {
  return vi.fn();
}
