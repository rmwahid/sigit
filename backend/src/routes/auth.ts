import {
  MIN_PASSWORD_LENGTH,
  RATE_LIMIT_INVITE_ACCEPT_MAX,
  RATE_LIMIT_LOGIN_ADDRESS_MAX,
  RATE_LIMIT_LOGIN_MAX,
  RATE_LIMIT_PASSWORD_MAX,
} from "@/constants/limits";
import { AUDIT_EVENTS } from "@/constants/audit-events";
import { ERROR_CODES } from "@/constants/errors";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { db } from "@/config/db";
import { users } from "@/db/schema/auth";
import { ROLE_SLUGS } from "@/constants/roles";
import { requireUser, type AuthEnv } from "@/middleware/auth";
import { env } from "@/config/env";
import { acceptInvitation, validateInvitation } from "@/modules/auth/invitations";
import { audit, log } from "@/lib/logger";
import { clientIdentity, resetRateLimit, throttleRequest, type RateLimitRule } from "@/lib/rate-limit";
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

// Whether the session cookie must carry Secure. Fails CLOSED: the cookie is
// only allowed without Secure when the request is a plain-HTTP loopback
// request in a non-production process (local dev on http://localhost:5173),
// which is the one case where a Secure cookie would simply not be stored. Any
// other plain-HTTP request - e.g. a bare-metal deployment that forgot to set
// NODE_ENV=production, or a reverse proxy that terminates TLS - is treated as
// secure so the session cannot travel in cleartext.
export function isSecureRequest(c: Parameters<typeof requireUser>[0]): boolean {
  const url = new URL(c.req.url);
  if (url.protocol === "https:") return true;
  if (c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() === "https") return true;
  const host = url.hostname;
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  if (!SECURE_COOKIE && loopback) return false;
  return true;
}

// Credential-guessing budgets. Reaching one returns 429 with Retry-After
// instead of continuing to spend argon2id work.
//
// Login is bounded twice. The account budget (keyed by the email being asked
// about) is what a successful login clears, so the owner's own typos are
// forgiven while a holder of any valid account cannot buy guesses against
// somebody else's. The address budget is a second, never-cleared bound that
// stops one client from spraying many accounts from one place.
const LOGIN_RULE: RateLimitRule = { name: "auth.login", max: RATE_LIMIT_LOGIN_MAX };
const LOGIN_ADDRESS_RULE: RateLimitRule = { name: "auth.login_address", max: RATE_LIMIT_LOGIN_ADDRESS_MAX };
const INVITE_ACCEPT_RULE: RateLimitRule = { name: "auth.invite_accept", max: RATE_LIMIT_INVITE_ACCEPT_MAX };
const PASSWORD_RULE: RateLimitRule = { name: "auth.password", max: RATE_LIMIT_PASSWORD_MAX };

// Content type a browser form submission cannot produce (it can only send
// urlencoded, multipart or text/plain), which is what makes a route that reads
// nothing from the body still unforgeable from another site.
const JSON_CONTENT_TYPE = /^application\/([a-z-.+]+\+)?json/i;

// Returns a 429 response when the budget for this identity is exhausted.
// Failed attempts are audited so the admin log view surfaces brute force.
function checkRateLimit(
  c: Parameters<typeof requireUser>[0],
  rule: RateLimitRule,
  identity = clientIdentity(c.req.raw.headers)
): Response | null {
  const blocked = throttleRequest(c, rule, identity);
  if (!blocked) return null;
  log.warn("auth", "rate limit exceeded", { rule: rule.name, identity });
  audit(AUDIT_EVENTS.AUTH_RATE_LIMITED, { rule: rule.name, identity });
  return blocked;
}

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
      body: { required: true, content: { "application/json": { schema: loginSchema } } },
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
      429: {
        description: "Too many attempts",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { email, password } = c.req.valid("json");
    const accountIdentity = email.trim().toLowerCase();
    const addressLimited = checkRateLimit(c, LOGIN_ADDRESS_RULE);
    if (addressLimited) return addressLimited as never;
    const accountLimited = checkRateLimit(c, LOGIN_RULE, accountIdentity);
    if (accountLimited) return accountLimited as never;
    const user = await getUserByEmail(email);
    if (!user) {
      audit(AUDIT_EVENTS.AUTH_LOGIN_FAILED, { email, reason: "unknown_email" });
      return c.json({ error: { code: ERROR_CODES.INVALID_CREDENTIALS, message: "Invalid credentials" } }, 401);
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      audit(AUDIT_EVENTS.AUTH_LOGIN_FAILED, { email, reason: "bad_password" });
      return c.json({ error: { code: ERROR_CODES.INVALID_CREDENTIALS, message: "Invalid credentials" } }, 401);
    }

    const { token } = await createSession(user.id);
    // A successful login forgives this account's own failures. The address-wide
    // budget is deliberately left standing: clearing it let any holder of one
    // valid account keep guessing other accounts' passwords from the same
    // address, since every success refilled the shared window.
    resetRateLimit(LOGIN_RULE, accountIdentity);
    c.header("Set-Cookie", sessionCookie(token, SESSION_MAX_AGE_SECONDS, isSecureRequest(c)));
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
    request: {
      // Logout is a cookie-authenticated mutation with nothing else to check, so
      // the request shape is what makes it unforgeable from another site: a form
      // submission cannot set a JSON content type without a CORS preflight, which
      // this app never grants. The handler enforces the content type because a
      // declared body only rejects a request whose value fails the schema, and an
      // empty object never does.
      body: { required: true, content: { "application/json": { schema: z.object({}).openapi("LogoutInput") } } },
    },
    responses: {
      200: {
        description: "Logged out",
        content: { "application/json": { schema: messageSchema } },
      },
    },
  }),
  async (c) => {
    // A browser form submission can only send urlencoded, multipart or text
    // content, so requiring a JSON request keeps a third-party page from ending
    // this session even in browsers that still send a SameSite=Lax cookie on a
    // cross-site top-level POST.
    if (!JSON_CONTENT_TYPE.test(c.req.header("Content-Type") ?? "")) {
      return c.json({ error: { code: ERROR_CODES.BAD_REQUEST, message: "Expected a JSON request body" } }, 400) as never;
    }
    const token = getSessionTokenFromCookie(c.req.header("Cookie"));
    if (token) await deleteSession(token);
    c.header("Set-Cookie", sessionCookie("", 0, isSecureRequest(c)));
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
      body: { required: true, content: { "application/json": { schema: passwordSchema } } },
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
    const limited = checkRateLimit(c, PASSWORD_RULE);
    if (limited) return limited as never;
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
      body: { required: true, content: { "application/json": { schema: changePasswordSchema } } },
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
    const limited = checkRateLimit(c, PASSWORD_RULE);
    if (limited) return limited as never;
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
        required: true,
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
    const limited = checkRateLimit(c, INVITE_ACCEPT_RULE);
    if (limited) return limited as never;
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
    c.header("Set-Cookie", sessionCookie(session.token, SESSION_MAX_AGE_SECONDS, isSecureRequest(c)));
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
