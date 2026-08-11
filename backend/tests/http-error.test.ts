import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { HttpError, errorResponse } from "../src/lib/http-error";

const app = new Hono();
app.get("/http-error", (c) => errorResponse(c, new HttpError(404, "NOT_FOUND", "Not found")));
app.get("/generic-error", (c) => errorResponse(c, new Error("boom")));

describe("http-error", () => {
  it("HttpError carries status and code", () => {
    const err = new HttpError(400, "BAD_REQUEST", "Bad input");
    expect(err.status).toBe(400);
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.name).toBe("HttpError");
  });

  it("errorResponse returns the standard error shape", async () => {
    const res = await app.request("/http-error");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found" } });
  });

  it("errorResponse maps generic errors to 500 INTERNAL_ERROR", async () => {
    const res = await app.request("/generic-error");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("boom");
  });
});
