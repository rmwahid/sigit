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
