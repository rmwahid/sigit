import { createMiddleware } from "hono/factory";
import type { Token, User } from "../db/schema/auth";
import { resolveTokenScope, validateToken, type TokenScope } from "../modules/auth/tokens";
import { classifyAction, scopeAllows, scopeForAction } from "../modules/auth/scopes";
import { getProjectByName, projectNameFromRouteParam } from "../modules/projects/projects";

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

// Auth for the git protocol (smart HTTP + LFS): the git client sends
// `Authorization: Basic base64(username:password)` - the password is the
// SiGit token (sigit_ prefix). Username is ignored (GitHub PAT style).
// PER-PROJECT access: a token only works for projects with a scope row.
// Minimum scope per action (clone/push/lfs) is defined in modules/auth/scopes.ts.
// "write" automatically includes "read". Expired tokens are rejected.
export const requireGitToken = createMiddleware<GitAuthEnv>(async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header || !header.startsWith("Basic ")) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, 401);
  }
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const password = decoded.includes(":") ? decoded.split(":")[1] : decoded;
  const token = await validateToken(password);
  if (!token) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, 401);
  }
  c.set("token", token);

  // Project not found -> skip the scope check here, let the handler return 404
  // (git/LFS error format stays as before).
  const name = projectNameFromRouteParam(c.req.param("name"));
  const project = name ? await getProjectByName(name) : undefined;
  if (project) {
    const scope = await resolveTokenScope(token.id, project.id);
    if (!scope) {
      return c.json({ error: { code: "FORBIDDEN", message: "Token has no access to this project" } }, 403);
    }
    const required = scopeForAction(classifyAction(c.req.method, c.req.path));
    if (!scopeAllows(scope, required)) {
      return c.json({ error: { code: "FORBIDDEN", message: `Token requires "${required}" scope for this project` } }, 403);
    }
    c.set("tokenScope", scope);
  }

  await next();
});
