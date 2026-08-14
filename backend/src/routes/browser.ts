import { Hono, type Context } from "hono";
import { z } from "zod";
import { optionalAuth, type AuthEnv } from "../middleware/auth";
import { ERROR_CODES } from "../constants/errors";
import { DEFAULT_HISTORY_LIMIT, MAX_FILE_BROWSER_BYTES, MAX_HISTORY_LIMIT } from "../constants/limits";
import { ARCHIVE_FORMAT_SLUGS, type ArchiveFormatSlug } from "../constants/protocol";
import { PROJECT_PERMISSIONS, type ProjectPermission } from "../constants/permissions";
import { getProjectAccess, hasPermission } from "../modules/auth/access";
import { getProject, projectHistory, projectRepoPath } from "../modules/projects/projects";
import {
  archive,
  getLog,
  isValidFilePath,
  isValidRefName,
  listBranches,
  listTree,
  readFileAtRef,
  resolveDefaultBranch,
  resolveHead,
} from "../modules/projects/git";
import { readAuditLog } from "../lib/logger";
import type { Project } from "../db/schema/projects";

// Public file browser powering the project page Code tab (tree, blob, refs,
// archive) plus the Activity feed. Mounted BEFORE the requireAuth block in
// index.ts (same pattern as git/lfs routes): auth is decided per request here -
// a session user needs the `view` permission, anonymous users only get public
// projects (Code + History, never Activity).
export const browserRoutes = new Hono<AuthEnv>();

browserRoutes.use("*", optionalAuth);

function error(c: Context, status: 400 | 401 | 403 | 404 | 500, code: string, message: string): Response {
  return c.json({ error: { code, message } }, status as never);
}

// Resolve + authorize the project: 404 unknown, 401 anonymous on private,
// 403 session user without the required permission (default `view`).
// Returns the project on success.
async function guard(c: Context<AuthEnv>, projectId: string, perm: ProjectPermission = PROJECT_PERMISSIONS.VIEW.slug): Promise<Project | Response> {
  const project = await getProject(projectId);
  if (!project) return error(c, 404, ERROR_CODES.NOT_FOUND, "Not found");
  const user = c.get("user");
  if (!user) {
    if (!project.isPublic) return error(c, 401, ERROR_CODES.UNAUTHORIZED, "Unauthorized");
  } else {
    const access = await getProjectAccess(user.id, project.id);
    if (!hasPermission(access, perm)) {
      return error(c, 403, ERROR_CODES.FORBIDDEN, "Forbidden");
    }
  }
  return project;
}

const treeQuerySchema = z.object({ ref: z.string().optional(), path: z.string().optional() });

// GET /projects/:id/refs - branches + head + default branch (branch selector).
browserRoutes.get("/:id/refs", async (c) => {
  const project = await guard(c, c.req.param("id"));
  if (project instanceof Response) return project;
  const repoPath = projectRepoPath(project.id);
  try {
    const [branches, head, defaultBranch] = await Promise.all([
      listBranches(repoPath),
      resolveHead(repoPath),
      resolveDefaultBranch(repoPath),
    ]);
    return c.json({ data: { branches, head, defaultBranch } });
  } catch {
    return error(c, 404, ERROR_CODES.NOT_FOUND, "No commits yet");
  }
});

// GET /projects/:id/tree?ref&path - one directory level (file list).
browserRoutes.get("/:id/tree", async (c) => {
  const project = await guard(c, c.req.param("id"));
  if (project instanceof Response) return project;
  const q = treeQuerySchema.safeParse(c.req.query());
  if (!q.success) return error(c, 400, ERROR_CODES.BAD_REQUEST, "Invalid query");
  const ref = q.data.ref ?? "HEAD";
  const dirPath = q.data.path ?? "";
  if (!isValidRefName(ref) || !isValidFilePath(dirPath)) {
    return error(c, 400, ERROR_CODES.BAD_REQUEST, "Invalid ref or path");
  }
  const repoPath = projectRepoPath(project.id);
  try {
    const entries = await listTree(repoPath, ref, dirPath);
    return c.json({ data: { ref, path: dirPath, entries } });
  } catch {
    return error(c, 404, ERROR_CODES.NOT_FOUND, "Path not found");
  }
});

const blobQuerySchema = z.object({ ref: z.string().optional(), path: z.string() });

// GET /projects/:id/blob?ref&path - file content (text or base64, 1 MB cap).
browserRoutes.get("/:id/blob", async (c) => {
  const project = await guard(c, c.req.param("id"));
  if (project instanceof Response) return project;
  const q = blobQuerySchema.safeParse(c.req.query());
  if (!q.success) return error(c, 400, ERROR_CODES.BAD_REQUEST, "Invalid query");
  const ref = q.data.ref ?? "HEAD";
  if (!isValidRefName(ref) || !isValidFilePath(q.data.path)) {
    return error(c, 400, ERROR_CODES.BAD_REQUEST, "Invalid ref or path");
  }
  const repoPath = projectRepoPath(project.id);
  const result = await readFileAtRef(repoPath, ref, q.data.path);
  if (!result.ok) {
    if (result.reason === "too-large") {
      return error(c, 400, ERROR_CODES.BAD_REQUEST, `File exceeds the ${MAX_FILE_BROWSER_BYTES / 1024 / 1024} MB preview limit`);
    }
    return error(c, 404, ERROR_CODES.NOT_FOUND, "File not found");
  }
  return c.json({
    data: { path: q.data.path, size: result.size, encoding: result.encoding, content: result.content },
  });
});

const archiveQuerySchema = z.object({ ref: z.string().optional(), format: z.string() });

// GET /projects/:id/archive?ref&format=zip|tar.gz - source download (raw bytes).
browserRoutes.get("/:id/archive", async (c) => {
  const project = await guard(c, c.req.param("id"));
  if (project instanceof Response) return project;
  const q = archiveQuerySchema.safeParse(c.req.query());
  if (!q.success) return error(c, 400, ERROR_CODES.BAD_REQUEST, "Invalid query");
  const ref = q.data.ref ?? "HEAD";
  if (!isValidRefName(ref)) return error(c, 400, ERROR_CODES.BAD_REQUEST, "Invalid ref");
  if (!ARCHIVE_FORMAT_SLUGS.includes(q.data.format as ArchiveFormatSlug)) {
    return error(c, 400, ERROR_CODES.BAD_REQUEST, "Unsupported format");
  }
  const repoPath = projectRepoPath(project.id);
  try {
    const buf = await archive(repoPath, ref, q.data.format as ArchiveFormatSlug);
    const safeRef = ref.replace(/[^A-Za-z0-9._-]/g, "-");
    return c.body(new Uint8Array(buf), 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${project.name}-${safeRef}.${q.data.format}"`,
    });
  } catch {
    return error(c, 404, ERROR_CODES.NOT_FOUND, "Ref not found");
  }
});

const activityQuerySchema = z.object({ limit: z.string().optional(), offset: z.string().optional() });

// GET /projects/:id/history?limit&offset - paginated commit history. Same
// permission as the authed API history endpoint (`history`), but reachable
// anonymously for public projects (Code + History are the public tabs).
browserRoutes.get("/:id/history", async (c) => {
  const project = await guard(c, c.req.param("id"), PROJECT_PERMISSIONS.HISTORY.slug);
  if (project instanceof Response) return project;
  const q = activityQuerySchema.safeParse(c.req.query());
  const limit = Math.min(Math.max(Number(q.data?.limit) || DEFAULT_HISTORY_LIMIT, 1), MAX_HISTORY_LIMIT);
  const offset = Math.max(Number(q.data?.offset) || 0, 0);
  try {
    const data = await projectHistory(project.id, limit, offset);
    return c.json({ data });
  } catch {
    return error(c, 404, ERROR_CODES.NOT_FOUND, "No commits yet");
  }
});

// GET /projects/:id/activity?limit&offset - commits + audit events, merged desc.
// Anonymous users never get activity (decision: public = Code + History only).
browserRoutes.get("/:id/activity", async (c) => {
  const project = await guard(c, c.req.param("id"), PROJECT_PERMISSIONS.HISTORY.slug);
  if (project instanceof Response) return project;
  if (!c.get("user")) return error(c, 401, ERROR_CODES.UNAUTHORIZED, "Unauthorized");
  const q = activityQuerySchema.safeParse(c.req.query());
  const limit = Math.min(Math.max(Number(q.data?.limit) || DEFAULT_HISTORY_LIMIT, 1), MAX_HISTORY_LIMIT);
  const offset = Math.max(Number(q.data?.offset) || 0, 0);
  const repoPath = projectRepoPath(project.id);
  const window = limit + offset;

  const commits = (await getLog(repoPath, window).catch(() => [])).map((cm) => ({
    type: "commit",
    ts: cm.date,
    message: cm.message,
    author: cm.author,
    hash: cm.hash,
  }));
  const events = readAuditLog(window * 2)
    .filter((e) => e.projectId === project.id)
    .map((e) => ({ type: "event", ts: String(e.ts ?? ""), ...e }));

  const merged = [...commits, ...events].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  return c.json({ data: merged.slice(offset, offset + limit) });
});
