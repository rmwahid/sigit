// Paired test for lib/rate-limit.ts: the fixed-window limiter that protects
// login, invite accept, password verification and the git token auth path.
import { describe, expect, it, beforeEach } from "bun:test";
import { Hono } from "hono";
import {
  clientIdentity,
  consumeRateLimit,
  rateLimitBucketCount,
  resetAllRateLimits,
  resetRateLimit,
  throttleRequest,
  type RateLimitRule,
} from "@/lib/rate-limit";
import { RATE_LIMIT_LOGIN_MAX, RATE_LIMIT_WINDOW_MS } from "@/constants/limits";
import { ERROR_CODES } from "@/constants/errors";

const RULE: RateLimitRule = { name: "test.rule", max: 3 };

describe("rate limiter", () => {
  beforeEach(() => {
    resetAllRateLimits();
  });

  it("allows attempts up to the budget then blocks", () => {
    for (let i = 0; i < RULE.max; i++) {
      expect(consumeRateLimit(RULE, "1.2.3.4").allowed).toBe(true);
    }
    const blocked = consumeRateLimit(RULE, "1.2.3.4");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks identities independently", () => {
    for (let i = 0; i < RULE.max; i++) consumeRateLimit(RULE, "a");
    expect(consumeRateLimit(RULE, "a").allowed).toBe(false);
    // A different client still has its full budget.
    expect(consumeRateLimit(RULE, "b").allowed).toBe(true);
  });

  it("tracks rules independently", () => {
    for (let i = 0; i < RULE.max; i++) consumeRateLimit(RULE, "a");
    const otherRule: RateLimitRule = { name: "test.other", max: 3 };
    expect(consumeRateLimit(otherRule, "a").allowed).toBe(true);
  });

  it("resets the window after it expires", () => {
    const start = 1_000_000;
    for (let i = 0; i < RULE.max; i++) consumeRateLimit(RULE, "a", start);
    expect(consumeRateLimit(RULE, "a", start).allowed).toBe(false);
    // Just past the window boundary the counter starts over.
    expect(consumeRateLimit(RULE, "a", start + RATE_LIMIT_WINDOW_MS + 1).allowed).toBe(true);
  });

  it("resetRateLimit clears one identity only", () => {
    for (let i = 0; i < RULE.max; i++) consumeRateLimit(RULE, "a");
    for (let i = 0; i < RULE.max; i++) consumeRateLimit(RULE, "b");
    resetRateLimit(RULE, "a");
    expect(consumeRateLimit(RULE, "a").allowed).toBe(true);
    expect(consumeRateLimit(RULE, "b").allowed).toBe(false);
  });

  it("honours a per-rule window override", () => {
    const tiny: RateLimitRule = { name: "test.tiny", max: 1, windowMs: 1000 };
    const start = 5_000_000;
    expect(consumeRateLimit(tiny, "a", start).allowed).toBe(true);
    expect(consumeRateLimit(tiny, "a", start).allowed).toBe(false);
    expect(consumeRateLimit(tiny, "a", start + 1001).allowed).toBe(true);
  });

  it("does not grow unboundedly when windows roll over", () => {
    const start = 9_000_000;
    for (let i = 0; i < 50; i++) {
      consumeRateLimit(RULE, `client-${i}`, start + i);
    }
    expect(rateLimitBucketCount()).toBe(50);
    // After the window passes for all of them, each key is replaced in place.
    for (let i = 0; i < 50; i++) {
      consumeRateLimit(RULE, `client-${i}`, start + RATE_LIMIT_WINDOW_MS + 1);
    }
    expect(rateLimitBucketCount()).toBe(50);
  });

  it("exposes the login budget as a positive number", () => {
    expect(RATE_LIMIT_LOGIN_MAX).toBeGreaterThan(0);
    expect(RATE_LIMIT_WINDOW_MS).toBeGreaterThan(0);
  });
});

describe("clientIdentity", () => {
  it("prefers the first x-forwarded-for entry", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    expect(clientIdentity(h)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", () => {
    expect(clientIdentity(new Headers({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
  });

  it("returns the provided fallback when no header is present", () => {
    expect(clientIdentity(new Headers(), "127.0.0.1")).toBe("127.0.0.1");
    expect(clientIdentity(new Headers())).toBe("unknown");
  });

  it("ignores an empty forwarded header", () => {
    expect(clientIdentity(new Headers({ "x-forwarded-for": "  " }), "direct")).toBe("direct");
  });
});

// Every throttled route goes through this helper, so its contract is asserted
// once here rather than per surface.
describe("throttleRequest", () => {
  const rule: RateLimitRule = { name: "test.http", max: 2 };
  const app = new Hono();
  app.get("/", (c) => {
    const blocked = throttleRequest(c, rule);
    if (blocked) return blocked;
    return c.json({ ok: true });
  });

  beforeEach(() => {
    resetAllRateLimits();
  });

  it("passes while the budget lasts, then answers 429 with Retry-After", async () => {
    const headers = { "x-forwarded-for": "203.0.113.9" };
    expect((await app.request("/", { headers })).status).toBe(200);
    expect((await app.request("/", { headers })).status).toBe(200);

    const blocked = await app.request("/", { headers });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    const body = (await blocked.json()) as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.RATE_LIMITED);
  });

  it("buckets per client identity", async () => {
    const spent = { "x-forwarded-for": "203.0.113.11" };
    await app.request("/", { headers: spent });
    await app.request("/", { headers: spent });
    expect((await app.request("/", { headers: spent })).status).toBe(429);

    // A second client keeps its own budget.
    expect((await app.request("/", { headers: { "x-forwarded-for": "203.0.113.12" } })).status).toBe(200);
  });
});
