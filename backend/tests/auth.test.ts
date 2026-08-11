import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/config/db";
import { users } from "../src/db/schema/auth";
import {
  createSession,
  deleteSession,
  generateSessionToken,
  getSessionTokenFromCookie,
  getUserByEmail,
  hashPassword,
  sessionCookie,
  validateSessionToken,
  verifyPassword,
} from "../src/modules/auth/auth";

const TEST_TIMEOUT = 30000;

describe("password hashing", () => {
  it("round-trips a password", async () => {
    const hash = await hashPassword("secret-123");
    expect(await verifyPassword("secret-123", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});

describe("session token", () => {
  it("generates unique base64url tokens", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("session cookie", () => {
  it("builds a cookie with security attributes", () => {
    const cookie = sessionCookie("tok123", 604800, true);
    expect(cookie).toContain("sigit_session=tok123");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
  });

  it("parses the token back from a cookie header", () => {
    const header = "other=1; sigit_session=tok123; foo=2";
    expect(getSessionTokenFromCookie(header)).toBe("tok123");
    expect(getSessionTokenFromCookie("no-cookie-here")).toBeNull();
  });
});

describe("session lifecycle (DB sigit)", () => {
  it("creates, validates, and deletes a session", async () => {
    const rows = await db.select().from(users).limit(1);
    expect(rows.length).toBeGreaterThan(0);
    const user = rows[0];

    // validateSessionToken returns null for a bogus token
    expect(await validateSessionToken("bogus-token")).toBeNull();

    const { token } = await createSession(user.id);
    expect(token.length).toBeGreaterThan(20);

    const validated = await validateSessionToken(token);
    expect(validated?.id).toBe(user.id);

    await deleteSession(token);
    expect(await validateSessionToken(token)).toBeNull();
  }, TEST_TIMEOUT);
});

describe("getUserByEmail (DB sigit)", () => {
  it("finds the existing user by email", async () => {
    const rows = await db.select().from(users).limit(1);
    const user = rows[0];
    if (!user) return; // tidak ada user: skip
    const found = await getUserByEmail(user.email);
    expect(found?.id).toBe(user.id);
    expect(await getUserByEmail("nonexistent@sigit.local")).toBeUndefined();
  }, TEST_TIMEOUT);
});
