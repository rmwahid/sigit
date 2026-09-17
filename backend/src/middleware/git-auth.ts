import { createMiddleware } from "hono/factory";
import { resolveTokenScope, type TokenScope, validateToken } from "@/modules/auth/tokens";
import { classifyAction, scopeAllows, scopeForAction } from "@/modules/auth/scopes";
import { getProjectAccess, hasPermission, type ProjectPermission } from "@/modules/auth/access";
import { getProjectByName, projectNameFromRouteParam } from "@/modules/projects/projects";
import { ACTION_PERMISSION, GIT_ACTIONS, type GitAction } from "@/constants/permissions";
import { BASIC_AUTH_PREFIX } from "@/constants/protocol";
import { TOKEN_SCOPES } from "@/constants/scopes";
import { ERROR_CODES } from "@/constants/errors";
import { RATE_LIMIT_GIT_TOKEN_MAX } from "@/constants/limits";
import { clientIdentity, consumeRateLimit, type RateLimitRule } from "@/lib/rate-limit";
import { audit, log } from "@/lib/logger";
import { AUDIT_EVENTS } from "@/constants/audit-events";
import type { Context } from "hono";
import type { Project } from "@/db/schema/projects";
import type { Token, User } from "@/db/schema/auth";

// Budget for failed token authentications per client address. Git clients
// retry and a clone issues several requests, so a successful authentication
// resets the counter instead of counting against it (only failures are
// consumed here, see the UNAUTHORIZED branch).
const GIT_TOKEN_RULE: RateLimitRule = { name: "git.token", max: RATE_LIMIT_GIT_TOKEN_MAX };

export type GitAuthEnv = {
  Variables: {
    user: User;
    // Authenticated token - used by LFS routes for per-operation scope checks
    // (e.g. batch operation "upload" requires write scope, not just PUT).
    token: Token;
    // Token scope already resolved per project by the middleware.
    tokenScope: TokenScope;
  };
};

// Actions an anonymous visitor may perform on a PUBLIC project (read-only).
const ANONYMOUS_ACTIONS: GitAction[] = [GIT_ACTIONS.CLONE, GIT_ACTIONS.LFS_DOWNLOAD, GIT_ACTIONS.LFS_BATCH];

function anonymousReadAllowed(project: Project | undefined, action: GitAction): boolean {
  return project?.isPublic === true && ANONYMOUS_ACTIONS.includes(action);
}

// Failed token attempt: charge the per-address budget so scripted guessing is
// throttled, then answer 429 or 401. Successful auths are never counted, so a
// git client retrying a valid token is unaffected.
function rejectBadToken(c: Context<GitAuthEnv>, projectName: string): Response {
  const identity = clientIdentity(c.req.raw.headers);
  const result = consumeRateLimit(GIT_TOKEN_RULE, identity);
  if (result.allowed) {
    return c.json({ error: { code: ERROR_CODES.UNAUTHORIZED, message: "Unauthorized" } }, 401);
  }
  log.warn("git", "token auth rate limit exceeded", { identity, project: projectName });
  audit(AUDIT_EVENTS.AUTH_RATE_LIMITED, { rule: GIT_TOKEN_RULE.name, identity, project: projectName });
  c.header("Retry-After", String(result.retryAfterSeconds));
  return c.json({ error: { code: ERROR_CODES.RATE_LIMITED, message: "Too many attempts. Try again later." } }, 429);
}

// Auth for the git protocol (smart HTTP + LFS):
// - With a token (Basic auth): token validity + per-project token scope AND the
//   token owner's collaborator permission (tokens are derived, so removing a
//   collaborator instantly invalidates their tokens for that project).
// - Without credentials: allowed only for PUBLIC projects on read actions
//   (clone, LFS download) - anonymous read-only.
// Admin users bypass collaborator checks (admin = owner of every project).
export const requireGitToken = createMiddleware<GitAuthEnv>(async (c, next) => {
  const name = projectNameFromRouteParam(c.req.param("name"));
  const project = name ? await getProjectByName(name) : undefined;
  const action = classifyAction(c.req.method, c.req.path);
  const permission: ProjectPermission = ACTION_PERMISSION[action];
  const header = c.req.header("Authorization");

  // Anonymous path: public project + read action only.
  if (!header || !header.startsWith(BASIC_AUTH_PREFIX)) {
    if (!anonymousReadAllowed(project, action)) {
      return c.json({ error: { code: ERROR_CODES.UNAUTHORIZED, message: "Unauthorized" } }, 401);
    }
    c.set("tokenScope", TOKEN_SCOPES.READ.slug);
    return next();
  }

  const decoded = Buffer.from(header.slice(BASIC_AUTH_PREFIX.length), "base64").toString("utf8");
  const password = decoded.includes(":") ? decoded.split(":")[1] : decoded;
  const token = await validateToken(password);
  if (!token) return rejectBadToken(c, name);
  c.set("token", token);

  // Project not found -> skip the checks here, let the handler return 404
  // (git/LFS error format stays as before).
  if (!project) {
    return next();
  }

  // Layer 1: the token owner must still have access (tokens are derived).
  const access = await getProjectAccess(token.userId, project.id);
  if (!hasPermission(access, permission)) {
    return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "Token owner has no access to this project" } }, 403);
  }

  // Layer 2: per-project token scope (read for read actions, write for push/LFS upload).
  const scope = await resolveTokenScope(token.id, project.id);
  if (!scope) {
    return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "Token has no access to this project" } }, 403);
  }
  const required: TokenScope = scopeForAction(action);
  if (!scopeAllows(scope, required)) {
    return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: `Token requires "${required}" scope for this project` } }, 403);
  }
  c.set("tokenScope", scope);

  await next();
});
