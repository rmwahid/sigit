import { describe, expect, it } from "bun:test";
import { z } from "@hono/zod-openapi";
import { errorSchema, idParamSchema, idResponseSchema, messageSchema } from "@/routes/schemas/common";

// Shared route schemas: id param, error envelope, message/id responses.
// These are the single source for the error envelope contract.

describe("schemas/common", () => {
  it("idParamSchema accepts a uuid and rejects junk", () => {
    expect(idParamSchema.parse({ id: "d096dd70-97bb-439e-b04b-646d958185dc" })).toEqual({
      id: "d096dd70-97bb-439e-b04b-646d958185dc",
    });
    expect(() => idParamSchema.parse({ id: "not-a-uuid" })).toThrow();
  });

  it("errorSchema enforces the { error: { code, message } } envelope", () => {
    const parsed = errorSchema.parse({ error: { code: "NOT_FOUND", message: "Not found" } });
    expect(parsed.error.code).toBe("NOT_FOUND");
    expect(() => errorSchema.parse({ error: { code: 42 } })).toThrow();
    expect(() => errorSchema.parse({ message: "bare" })).toThrow();
  });

  it("messageSchema and idResponseSchema accept their payloads", () => {
    expect(messageSchema.parse({ message: "ok" })).toEqual({ message: "ok" });
    expect(idResponseSchema.parse({ id: "abc" })).toEqual({ id: "abc" });
    expect(idResponseSchema.parse({ id: "abc" }).id).toBe("abc");
  });

  it("schemas are zod objects usable for openapi metadata", () => {
    expect(errorSchema._def.typeName).toBe(z.ZodFirstPartyTypeKind.ZodObject);
  });
});
