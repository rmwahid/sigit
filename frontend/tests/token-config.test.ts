import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOKEN_SCOPE,
  scopeLabel,
  TOKEN_SCOPE_OPTIONS,
  TOKEN_SCOPES,
} from "../src/lib/constants/scopes";
import {
  TOKEN_DEFAULT_EXPIRY_DAYS,
  TOKEN_MAX_EXPIRY_DAYS,
} from "../src/lib/constants/validation";

describe("token scopes", () => {
  it("maps write to its display name (write implies read)", () => {
    expect(scopeLabel("write")).toBe("Read + Write");
  });

  it("maps read to its display name", () => {
    expect(scopeLabel("read")).toBe("Read");
  });

  it("covers read and write with matching labels", () => {
    expect(TOKEN_SCOPE_OPTIONS).toEqual([
      { value: "read", label: "Read" },
      { value: "write", label: "Read + Write" },
    ]);
  });

  it("defaults scope to read and expiry to 30 days", () => {
    expect(DEFAULT_TOKEN_SCOPE).toBe(TOKEN_SCOPES.READ.slug);
    expect(TOKEN_DEFAULT_EXPIRY_DAYS).toBe(30);
    expect(TOKEN_MAX_EXPIRY_DAYS).toBe(30);
  });
});
