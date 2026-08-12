import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import type { User } from "../db/schema/auth";
import { getSessionTokenFromCookie, validateSessionToken } from "../modules/auth/auth";

export type AuthEnv = {
  Variables: {
    user: User;
  };
};

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const token = getSessionTokenFromCookie(c.req.header("Cookie"));
  if (!token) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, 401);
  }
  const user = await validateSessionToken(token);
  if (!user) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, 401);
  }
  c.set("user", user);
  await next();
});

export const optionalAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const token = getSessionTokenFromCookie(c.req.header("Cookie"));
  if (token) {
    const user = await validateSessionToken(token);
    if (user) c.set("user", user);
  }
  await next();
});

// Helper untuk route OpenAPIHono: validasi session cookie, return user atau null.
// Dipanggil DI DALAM handler (bukan wrapper) supaya handler tetap menerima
// route-typed context dari openapi() — c.req.valid() dan response typing jalan.
// (Wrapper `authed` dihapus: generic-nya meng-eras tipe route dan memicu
// error tsc pre-existing "valid() -> never" di seluruh route.)
export async function requireUser(c: Context<AuthEnv>): Promise<User | null> {
  const token = getSessionTokenFromCookie(c.req.header("Cookie"));
  if (!token) return null;
  return validateSessionToken(token);
}
