import { Hono } from "hono";
import { handleGitRequest } from "../modules/git/server";
import { requireGitToken } from "../middleware/git-auth";
import { projectNameFromRouteParam } from "../modules/projects/projects";

// Git smart HTTP: /projects/<name>.git/<path>
// git client memanggil: info/refs?service=git-upload-pack|git-receive-pack,
// git-upload-pack, git-receive-pack (POST dengan packfile).
//
// PENTING 1: param pakai regex `:name{.+\.git}` — di Hono versi ini,
// `:name.git` MATCH SEMUA path /x/y (literal ".git" diabaikan), sehingga
// route git membajak API routes (/projects/{id}/history dll).
// PENTING 2: requireGitToken hanya di route .git — API routes pakai session.
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
