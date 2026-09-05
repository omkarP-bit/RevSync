import { describe, it, expect, vi, beforeEach } from "vitest";

describe("loadConfig", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should load config from environment variables", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
    process.env.JWT_SECRET = "super-secret-key-16+";

    const { loadConfig } = await import("../config.js");
    const config = loadConfig();

    expect(config.DATABASE_URL).toBe("postgresql://test:test@localhost/test");
    expect(config.JWT_SECRET).toBe("super-secret-key-16+");
    expect(config.PORT).toBe(3001);
    expect(config.JWT_EXPIRES_IN).toBe("15m");
    expect(config.DEFAULT_CURRENCY_CODE).toBe("USD");
  });

  it("should throw if DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;
    process.env.JWT_SECRET = "valid-secret-key-16+";

    const { loadConfig } = await import("../config.js");
    expect(() => loadConfig()).toThrow();
  });

  it("should throw if JWT_SECRET is too short", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
    process.env.JWT_SECRET = "short";

    const { loadConfig } = await import("../config.js");
    expect(() => loadConfig()).toThrow();
  });

  it("should coerce PORT to number", async () => {
    process.env.PORT = "4000";
    process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
    process.env.JWT_SECRET = "valid-secret-key-16+";

    const { loadConfig } = await import("../config.js");
    const config = loadConfig();
    expect(config.PORT).toBe(4000);
  });
});
