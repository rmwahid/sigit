import { ERROR_CODES } from "@/constants/errors";
import { createMiddleware } from "hono/factory";
import { type User } from "@/db/schema/auth";
import { ADMIN_ROLE } from "@/constants/roles";
import { getSessionTokenFromCookie, validateSessionToken } from "@/modules/auth/auth";
import type { Context } from "hono";

export type AuthEnv = {
  Variables: {
    user: User;
  };
};

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const token = getSessionTokenFromCookie(c.req.header("Cookie"));
  if (!token) {
    return c.json({ error: { code: ERROR_CODES.UNAUTHORIZED, message: "Unauthorized" } }, 401);
  }
  const user = await validateSessionToken(token);
  if (!user) {
    return c.json({ error: { code: ERROR_CODES.UNAUTHORIZED, message: "Unauthorized" } }, 401);
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

// Helper for OpenAPIHono routes: validate the session cookie, return user or null.
// Called INSIDE the handler (not as a wrapper) so the handler keeps the
// route-typed context from openapi() - c.req.valid() and response typing work.
// (The `authed` wrapper was removed: its generics erased route types and caused
// pre-existing tsc errors "valid() -> never" across routes.)
export async function requireUser(c: Context<AuthEnv>): Promise<User | null> {
  const token = getSessionTokenFromCookie(c.req.header("Cookie"));
  if (!token) return null;
  return validateSessionToken(token);
}

// Admin-only guard (site owner). Returns null for non-admin users.
export async function requireAdmin(c: Context<AuthEnv>): Promise<User | null> {
  const user = await requireUser(c);
  if (!user || user.role !== ADMIN_ROLE) return null;
  return user;
}
