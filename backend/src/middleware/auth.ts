import { createMiddleware } from "hono/factory";
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
    return c.json({ error: "Unauthorized" }, 401);
  }
  const user = await validateSessionToken(token);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
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
