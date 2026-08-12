import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOKEN_EXPIRY_DAYS,
  DEFAULT_TOKEN_SCOPE,
  scopeLabel,
  TOKEN_MAX_EXPIRY_DAYS,
  TOKEN_SCOPE_OPTIONS,
} from "../src/lib/token-config";

describe("scopeLabel", () => {
  it("maps write to read+write (write implies read)", () => {
    expect(scopeLabel("write")).toBe("read+write");
  });

  it("maps read to read", () => {
    expect(scopeLabel("read")).toBe("read");
  });
});

describe("TOKEN_SCOPE_OPTIONS", () => {
  it("covers read and write with matching labels", () => {
    expect(TOKEN_SCOPE_OPTIONS).toEqual([
      { value: "read", label: "read" },
      { value: "write", label: "read+write" },
    ]);
  });
});

describe("token scope and expiry defaults", () => {
  it("defaults scope to read", () => {
    expect(DEFAULT_TOKEN_SCOPE).toBe("read");
  });

  it("defaults expiry to 30 days, matching backend max", () => {
    expect(DEFAULT_TOKEN_EXPIRY_DAYS).toBe(30);
    expect(TOKEN_MAX_EXPIRY_DAYS).toBe(30);
  });
});
