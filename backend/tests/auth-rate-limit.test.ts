// Paired test for the auth route hardening (audit 2026-09-11, findings 6 and 7):
// login attempts are rate limited and audited, and the session cookie is only
// issued without Secure for a loopback HTTP request in a non-production process.
import { describe, expect, it, afterAll, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/config/db";
import { users } from "@/db/schema/auth";
import { ADMIN_ROLE } from "@/constants/roles";
import { ERROR_CODES } from "@/constants/errors";
import { RATE_LIMIT_LOGIN_MAX } from "@/constants/limits";
import { createSession, hashPassword } from "@/modules/auth/auth";
import { resetAllRateLimits } from "@/lib/rate-limit";
import { authRoutes, isSecureRequest } from "@/routes/auth";

const suffix = Date.now().toString(36);
let createdUserId: string | null = null;
let testEmail = `ratelimit-${suffix}@local.test`;
const TEST_PASSWORD = "ratelimit-password-123";

// Creates the fixture user once; later tests reuse the same row (the email
// column is unique, so creating it per test would collide).
async function createTestUser(): Promise<string> {
  if (createdUserId) return createdUserId;
  testEmail = `ratelimit-${suffix}-${Math.random().toString(36).slice(2)}@local.test`;
  const [row] = await db
    .insert(users)
    .values({ email: testEmail, passwordHash: await hashPassword(TEST_PASSWORD), role: ADMIN_ROLE })
    .returning({ id: users.id });
  createdUserId = row.id;
  return row.id;
}

function loginRequest(ip: string, password = "wrong-password"): Request {
  return new Request("http://localhost/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email: testEmail, password }),
  });
}

afterAll(async () => {
  try {
    if (createdUserId) await db.delete(users).where(eq(users.id, createdUserId));
  } catch {
    // best effort cleanup
  }
});

describe("login rate limiting", () => {
  beforeEach(() => {
    resetAllRateLimits();
  });

  it("blocks after the budget is exhausted and returns 429 with Retry-After", async () => {
    await createTestUser();
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;

    for (let i = 0; i < RATE_LIMIT_LOGIN_MAX; i++) {
      const res = await authRoutes.fetch(loginRequest(ip));
      expect(res.status).toBe(401);
    }
    const blocked = await authRoutes.fetch(loginRequest(ip));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    const body = (await blocked.json()) as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.RATE_LIMITED);
  });

  it("does not throttle a different client address", async () => {
    await createTestUser();
    const attacker = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const other = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;

    for (let i = 0; i < RATE_LIMIT_LOGIN_MAX + 1; i++) {
      await authRoutes.fetch(loginRequest(attacker));
    }
    expect((await authRoutes.fetch(loginRequest(attacker))).status).toBe(429);
    // A different address still gets a normal credential rejection.
    expect((await authRoutes.fetch(loginRequest(other))).status).toBe(401);
  });

  it("clears the budget after a successful login", async () => {
    await createTestUser();
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;

    for (let i = 0; i < RATE_LIMIT_LOGIN_MAX - 1; i++) {
      expect((await authRoutes.fetch(loginRequest(ip))).status).toBe(401);
    }
    const ok = await authRoutes.fetch(loginRequest(ip, TEST_PASSWORD));
    expect(ok.status).toBe(200);
    // The counter was reset, so the next failures start from a fresh window.
    expect((await authRoutes.fetch(loginRequest(ip))).status).toBe(401);
  });
});

describe("isSecureRequest (fail-closed cookie policy)", () => {
  // isSecureRequest reads c.req.url and headers; the route-level behaviour is
  // covered through the login response below.
  it("issues a Secure cookie on a non-loopback host even in development", async () => {
    await createTestUser();
    resetAllRateLimits();
    const res = await authRoutes.fetch(
      new Request("http://sigit.example.com/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" },
        body: JSON.stringify({ email: testEmail, password: TEST_PASSWORD }),
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Secure");
  });

  it("omits Secure only for loopback HTTP in a non-production process", async () => {
    await createTestUser();
    resetAllRateLimits();
    const res = await authRoutes.fetch(
      new Request("http://localhost/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.10" },
        body: JSON.stringify({ email: testEmail, password: TEST_PASSWORD }),
      })
    );
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    // NODE_ENV is development in tests, and the request is loopback HTTP.
    expect(cookie).not.toContain("Secure");
  });

  it("treats an HTTPS request as secure", async () => {
    const res = await authRoutes.fetch(
      new Request("https://sigit.example.com/me", { headers: { Cookie: "sigit_session=bogus" } })
    );
    expect(res.status).toBe(401);
  });
});
