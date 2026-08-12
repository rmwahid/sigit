import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { db } from "../config/db";
import { users } from "../db/schema/auth";
import { requireUser, type AuthEnv } from "../middleware/auth";
import { env } from "../config/env";
import {
  createSession,
  deleteAllSessions,
  deleteSession,
  getSessionTokenFromCookie,
  getUserByEmail,
  sessionCookie,
  updateUserPassword,
  verifyPassword,
} from "../modules/auth/auth";
import { audit } from "../lib/logger";

const SESSION_TTL_DAYS = Number(env.SESSION_TTL_DAYS);
const SESSION_MAX_AGE = SESSION_TTL_DAYS * 24 * 60 * 60;
const SECURE_COOKIE = env.NODE_ENV === "production";

const loginSchema = z.object({
  email: z.string().email().openapi({ example: "admin@sigit.dev" }),
  password: z.string().min(1),
});

const passwordSchema = z.object({
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

const meResponse = z.object({
  data: z.object({
    id: z.string(),
    email: z.string(),
  }),
});

const messageResponse = z.object({ message: z.string() }).openapi("Message");
const errorSchema = z.object({ error: z.string() }).openapi("Error");

export const authRoutes = new OpenAPIHono<AuthEnv>();

authRoutes.openapi(
  createRoute({
    method: "get",
    path: "/me",
    tags: ["Auth"],
    summary: "Get current user",
    responses: {
      200: {
        description: "Current user",
        content: { "application/json": { schema: meResponse } },
      },
      401: {
        description: "Unauthorized",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, 401) as never;
    return c.json({ data: { id: user.id, email: user.email } });
  }
);

authRoutes.openapi(
  createRoute({
    method: "post",
    path: "/login",
    tags: ["Auth"],
    summary: "Login with email and password",
    request: {
      body: { content: { "application/json": { schema: loginSchema } } },
    },
    responses: {
      200: {
        description: "Logged in, session cookie set",
        content: { "application/json": { schema: meResponse } },
      },
      401: {
        description: "Invalid credentials",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { email, password } = c.req.valid("json");
    const user = await getUserByEmail(email);
    if (!user) return c.json({ error: { code: "INVALID_CREDENTIALS", message: "Invalid credentials" } }, 401);
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return c.json({ error: { code: "INVALID_CREDENTIALS", message: "Invalid credentials" } }, 401);

    const { token } = await createSession(user.id);
    c.header("Set-Cookie", sessionCookie(token, SESSION_MAX_AGE, SECURE_COOKIE));
    audit("auth.login", { userId: user.id, email: user.email });
    return c.json({ data: { id: user.id, email: user.email } });
  }
);

authRoutes.openapi(
  createRoute({
    method: "post",
    path: "/logout",
    tags: ["Auth"],
    summary: "Logout current session",
    responses: {
      200: {
        description: "Logged out",
        content: { "application/json": { schema: messageResponse } },
      },
    },
  }),
  async (c) => {
    const token = getSessionTokenFromCookie(c.req.header("Cookie"));
    if (token) await deleteSession(token);
    c.header("Set-Cookie", sessionCookie("", 0, SECURE_COOKIE));
    audit("auth.logout", {});
    return c.json({ message: "Logged out" });
  }
);

authRoutes.openapi(
  createRoute({
    method: "post",
    path: "/revoke-all",
    tags: ["Auth"],
    summary: "Revoke all sessions (except current) after verifying password",
    request: {
      body: { content: { "application/json": { schema: passwordSchema } } },
    },
    responses: {
      200: {
        description: "All other sessions revoked",
        content: { "application/json": { schema: messageResponse } },
      },
      401: {
        description: "Invalid password",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { password } = c.req.valid("json");
    const user = await requireUser(c);
    if (!user) return c.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, 401) as never;
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return c.json({ error: { code: "INVALID_PASSWORD", message: "Invalid password" } }, 401) as never;

    const token = getSessionTokenFromCookie(c.req.header("Cookie")) ?? undefined;
    await deleteAllSessions(user.id, token);
    audit("auth.revoke_all", { userId: user.id });
    return c.json({ message: "All other sessions revoked" });
  }
);

authRoutes.openapi(
  createRoute({
    method: "post",
    path: "/change-password",
    tags: ["Auth"],
    summary: "Change password and revoke all other sessions",
    request: {
      body: { content: { "application/json": { schema: changePasswordSchema } } },
    },
    responses: {
      200: {
        description: "Password changed",
        content: { "application/json": { schema: messageResponse } },
      },
      401: {
        description: "Invalid current password",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { currentPassword, newPassword } = c.req.valid("json");
    const user = await requireUser(c);
    if (!user) return c.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, 401) as never;
    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) return c.json({ error: { code: "INVALID_CURRENT_PASSWORD", message: "Invalid current password" } }, 401) as never;

    await updateUserPassword(user.id, newPassword);
    const token = getSessionTokenFromCookie(c.req.header("Cookie")) ?? undefined;
    await deleteAllSessions(user.id, token);
    audit("auth.change_password", { userId: user.id });
    return c.json({ message: "Password changed" });
  }
);

// Bootstrap check: is there any user? (used by frontend to decide setup vs login)
authRoutes.openapi(
  createRoute({
    method: "get",
    path: "/bootstrap",
    tags: ["Auth"],
    summary: "Check whether an admin user exists yet",
    responses: {
      200: {
        description: "Bootstrap status",
        content: {
          "application/json": {
            schema: z.object({ data: z.object({ needsSetup: z.boolean() }) }),
          },
        },
      },
    },
  }),
  async (c) => {
    const rows = await db.select({ id: users.id }).from(users);
    return c.json({ data: { needsSetup: rows.length === 0 } });
  }
);
