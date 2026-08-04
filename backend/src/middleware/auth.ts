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

// Wrapper for OpenAPIHono routes that need auth as a single handler.
// (openapi() accepts only ONE handler; middleware cannot be passed separately.)
export function authed(handler: (c: Context<AuthEnv>) => Promise<Response>) {
  return async (c: Context<AuthEnv>): Promise<Response> => {
    const token = getSessionTokenFromCookie(c.req.header("Cookie"));
    if (!token) return c.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, 401);
    const user = await validateSessionToken(token);
    if (!user) return c.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, 401);
    c.set("user", user);
    return handler(c);
  };
}
