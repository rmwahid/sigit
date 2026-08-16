import { describe, expect, it } from "bun:test";
import { parseBootstrapEnv } from "@/cli/create-admin";

// Pure validation for the container entrypoint's non-interactive admin
// bootstrap (ADMIN_EMAIL + ADMIN_PASSWORD environment variables).
describe("admin bootstrap env", () => {
  it("accepts a valid email and password", () => {
    expect(parseBootstrapEnv({ ADMIN_EMAIL: "Admin@Example.com ", ADMIN_PASSWORD: "password123" })).toEqual({
      email: "admin@example.com",
      password: "password123",
    });
  });

  it("rejects a malformed email", () => {
    expect(() => parseBootstrapEnv({ ADMIN_EMAIL: "not-an-email", ADMIN_PASSWORD: "password123" })).toThrow(
      /ADMIN_EMAIL/
    );
    expect(() => parseBootstrapEnv({ ADMIN_PASSWORD: "password123" })).toThrow(/ADMIN_EMAIL/);
  });

  it("rejects a short password", () => {
    expect(() => parseBootstrapEnv({ ADMIN_EMAIL: "a@b.co", ADMIN_PASSWORD: "short" })).toThrow(/ADMIN_PASSWORD/);
  });
});
