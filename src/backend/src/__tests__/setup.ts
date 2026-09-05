// Set test environment variables before any imports
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test_db";
process.env.JWT_SECRET = "test-jwt-secret-min-16-chars";
process.env.JWT_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "7d";
process.env.LOG_LEVEL = "error";

import { vi } from "vitest";

// Mock the database pool module
vi.mock("../database/pool.js", () => ({
  query: vi.fn(),
  getPool: vi.fn(() => ({
    query: vi.fn(),
    connect: vi.fn(),
    end: vi.fn(),
  })),
  withTransaction: vi.fn(),
}));

// Mock the logger to suppress output during tests
vi.mock("../shared/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));
