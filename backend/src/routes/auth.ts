import { MIN_PASSWORD_LENGTH } from "@/constants/limits";
import { AUDIT_EVENTS } from "@/constants/audit-events";
import { ERROR_CODES } from "@/constants/errors";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { db } from "@/config/db";
import { users } from "@/db/schema/auth";
import { ROLE_SLUGS } from "@/constants/roles";
import { requireUser, type AuthEnv } from "@/middleware/auth";
import { env } from "@/config/env";
import { acceptInvitation, validateInvitation } from "@/modules/auth/invitations";
import { audit } from "@/lib/logger";
import { errorSchema, messageSchema } from "./schemas/common";
import {
  createSession,
  deleteAllSessions,
  deleteSession,
  getSessionTokenFromCookie,
  getUserByEmail,
  sessionCookie,
  updateUserPassword,
  verifyPassword,
  SESSION_MAX_AGE_SECONDS,
} from "@/modules/auth/auth";

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
  newPassword: z.string().min(MIN_PASSWORD_LENGTH),
});

const meResponse = z.object({
  data: z.object({
    id: z.string(),
    email: z.string(),
    role: z.string(),
  }),
});

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
    if (!user) return c.json({ error: { code: ERROR_CODES.UNAUTHORIZED, message: "Unauthorized" } }, 401) as never;
    return c.json({ data: { id: user.id, email: user.email, role: user.role } });
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
    if (!user) return c.json({ error: { code: ERROR_CODES.INVALID_CREDENTIALS, message: "Invalid credentials" } }, 401);
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return c.json({ error: { code: ERROR_CODES.INVALID_CREDENTIALS, message: "Invalid credentials" } }, 401);

    const { token } = await createSession(user.id);
    c.header("Set-Cookie", sessionCookie(token, SESSION_MAX_AGE_SECONDS, SECURE_COOKIE));
    audit(AUDIT_EVENTS.AUTH_LOGIN, { userId: user.id, email: user.email });
    return c.json({ data: { id: user.id, email: user.email, role: user.role } });
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
        content: { "application/json": { schema: messageSchema } },
      },
    },
  }),
  async (c) => {
    const token = getSessionTokenFromCookie(c.req.header("Cookie"));
    if (token) await deleteSession(token);
    c.header("Set-Cookie", sessionCookie("", 0, SECURE_COOKIE));
    audit(AUDIT_EVENTS.AUTH_LOGOUT, {});
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
        content: { "application/json": { schema: messageSchema } },
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
    if (!user) return c.json({ error: { code: ERROR_CODES.UNAUTHORIZED, message: "Unauthorized" } }, 401) as never;
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return c.json({ error: { code: ERROR_CODES.INVALID_PASSWORD, message: "Invalid password" } }, 401) as never;

    const token = getSessionTokenFromCookie(c.req.header("Cookie")) ?? undefined;
    await deleteAllSessions(user.id, token);
    audit(AUDIT_EVENTS.AUTH_REVOKE_ALL, { userId: user.id });
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
        content: { "application/json": { schema: messageSchema } },
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
    if (!user) return c.json({ error: { code: ERROR_CODES.UNAUTHORIZED, message: "Unauthorized" } }, 401) as never;
    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) return c.json({ error: { code: ERROR_CODES.INVALID_CURRENT_PASSWORD, message: "Invalid current password" } }, 401) as never;

    await updateUserPassword(user.id, newPassword);
    const token = getSessionTokenFromCookie(c.req.header("Cookie")) ?? undefined;
    await deleteAllSessions(user.id, token);
    audit(AUDIT_EVENTS.AUTH_CHANGE_PASSWORD, { userId: user.id });
    return c.json({ message: "Password changed" });
  }
);

// Invitation flow (public): validate the invite token and set the password.
authRoutes.openapi(
  createRoute({
    method: "get",
    path: "/invite",
    tags: ["Auth"],
    summary: "Validate an invitation token",
    request: { query: z.object({ token: z.string() }) },
    responses: {
      200: {
        description: "Invitation info",
        content: {
          "application/json": {
            schema: z.object({
              data: z.object({ email: z.string(), role: z.enum(ROLE_SLUGS) }),
            }),
          },
        },
      },
      404: {
        description: "Invalid or expired invitation",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { token } = c.req.valid("query");
    const invitation = await validateInvitation(token);
    if (!invitation) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Invalid or expired invitation" } }, 404);
    return c.json({ data: { email: invitation.email, role: invitation.role } });
  }
);

authRoutes.openapi(
  createRoute({
    method: "post",
    path: "/invite/accept",
    tags: ["Auth"],
    summary: "Accept an invitation and set the password (auto-login)",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ token: z.string(), password: z.string().min(MIN_PASSWORD_LENGTH) }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Account created, session cookie set",
        content: { "application/json": { schema: meResponse } },
      },
      404: {
        description: "Invalid or expired invitation",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { token, password } = c.req.valid("json");
    let accepted;
    try {
      accepted = await acceptInvitation(token, password);
    } catch (err) {
      const message = err instanceof Error && err.message === ERROR_CODES.EMAIL_TAKEN ? "Email already registered" : "Invalid or expired invitation";
      const code = err instanceof Error && err.message === ERROR_CODES.EMAIL_TAKEN ? "EMAIL_TAKEN" : "NOT_FOUND";
      return c.json({ error: { code, message } }, code === "EMAIL_TAKEN" ? 400 : 404) as never;
    }
    const session = await createSession(accepted.id);
    c.header("Set-Cookie", sessionCookie(session.token, SESSION_MAX_AGE_SECONDS, SECURE_COOKIE));
    audit(AUDIT_EVENTS.AUTH_INVITE_ACCEPT, { userId: accepted.id, email: accepted.email, role: accepted.role });
    return c.json({ data: { id: accepted.id, email: accepted.email, role: accepted.role } });
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
