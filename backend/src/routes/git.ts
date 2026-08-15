import { Hono } from "hono";
import { handleGitRequest } from "@/modules/git/server";
import { requireGitToken } from "@/middleware/git-auth";
import { projectNameFromRouteParam } from "@/modules/projects/projects";

// Git smart HTTP: /projects/<name>.git/<path>
// the git client calls: info/refs?service=git-upload-pack|git-receive-pack,
// git-upload-pack, git-receive-pack (POST with a packfile).
//
// IMPORTANT 1: the param uses the regex `:name{.+\.git}` - in this Hono version
// `:name.git` matches ALL /x/y paths (the literal ".git" is ignored), so the
// git routes would hijack API routes (/projects/{id}/history etc).
// IMPORTANT 2: requireGitToken is only on .git routes - API routes use sessions.
export const gitRoutes = new Hono();

gitRoutes.get("/:name{.+\.git}/*", requireGitToken, async (c) => {
  const name = projectNameFromRouteParam(c.req.param("name"));
  const pathInfo = c.req.path.replace(/^\/projects\/[^/]+\.git/, "") || "/";
  return handleGitRequest(c, name, pathInfo);
});

gitRoutes.post("/:name{.+\.git}/*", requireGitToken, async (c) => {
  const name = projectNameFromRouteParam(c.req.param("name"));
  const pathInfo = c.req.path.replace(/^\/projects\/[^/]+\.git/, "") || "/";
  return handleGitRequest(c, name, pathInfo);
});
