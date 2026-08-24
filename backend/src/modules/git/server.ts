import { REMOTE_USER } from "@/constants/protocol";
import { AUDIT_EVENTS } from "@/constants/audit-events";
import { ERROR_CODES } from "@/constants/errors";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { env } from "@/config/env";
import { getProjectByName, projectRepoPath } from "@/modules/projects/projects";
import { backupProject } from "@/modules/projects/backup";
import type { Project } from "@/db/schema/projects";
import { refreshOpenPrMergeability } from "@/modules/pull-requests/merge";
import { audit, log } from "@/lib/logger";
import path from "node:path";
import type { Context } from "hono";

const PROJECTS_ROOT = path.resolve(env.SIGIT_PROJECTS_ROOT);

// Auto-backup after a successful push: the bundle is rebuilt from the full
// history on every push, so a transient storage outage only leaves the stored
// bundle stale until the next successful backup. Retry with a short backoff to
// ride out brief storage hiccups; the last failure is logged (the push itself
// already succeeded and is not rolled back).
const BACKUP_RETRIES = 3;
const BACKUP_RETRY_DELAY_MS = 500;

// Takes the full Project row: backupProject reads storageConnectionId to
// resolve the user storage connection (a bare {id} would always fail).
export async function backupWithRetry(project: Project): Promise<void> {
  for (let attempt = 1; attempt <= BACKUP_RETRIES; attempt++) {
    try {
      await backupProject(project);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt === BACKUP_RETRIES) {
        log.error("backup", "auto backup after push failed after retries", {
          projectId: project.id,
          projectName: project.name,
          error: message,
          attempts: attempt,
        });
      } else {
        log.warn("backup", "auto backup after push failed, retrying", {
          projectId: project.id,
          projectName: project.name,
          error: message,
          attempt,
        });
        await new Promise((resolve) => setTimeout(resolve, BACKUP_RETRY_DELAY_MS * attempt));
      }
    }
  }
}

// git http-backend uses CGI conventions: header lines like
// "Status: 200 OK" + "Content-Type: ..." then \r\n\r\n and the body.
export async function parseCgiHeaders(
  bodyStream: ReadableStream<Uint8Array>
): Promise<{ status: number; headers: Headers; body: ReadableStream<Uint8Array> }> {
  const reader = bodyStream.getReader();
  const separator = Buffer.from("\r\n\r\n");
  let headerBuf = Buffer.alloc(0);

  while (headerBuf.indexOf(separator) === -1) {
    const { done, value } = await reader.read();
    if (done) throw new Error("git http-backend returned no headers");
    headerBuf = Buffer.concat([headerBuf, value]);
    if (headerBuf.length > 64 * 1024) throw new Error("CGI headers too large");
  }

  const idx = headerBuf.indexOf(separator);
  const headerText = headerBuf.subarray(0, idx).toString("utf8");
  const rest = headerBuf.subarray(idx + 4);

  let status = 200;
  const headers = new Headers();
  for (const line of headerText.split("\r\n")) {
    const lower = line.toLowerCase();
    if (lower.startsWith("status:")) {
      status = Number(line.split(":")[1]?.trim().split(" ")[0] ?? 200);
    } else {
      const colon = line.indexOf(":");
      if (colon > 0) {
        headers.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
      }
    }
  }

  // Body stream: remaining header bytes already read + the rest from the original reader.
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (rest.length) controller.enqueue(rest);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
  });

  return { status, headers, body };
}

export async function handleGitRequest(c: Context, projectName: string, pathInfo: string): Promise<Response> {  const project = await getProjectByName(projectName);
  if (!project) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Project not found" } }, 404);

  const url = new URL(c.req.url);
  // PATH_INFO uses the UUID (bare repo folder), the URL keeps the project name.
  const token = c.get("token");
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    GIT_PROJECT_ROOT: PROJECTS_ROOT,
    GIT_HTTP_EXPORT_ALL: "1",
    PATH_INFO: `/${project.id}${pathInfo}`,
    QUERY_STRING: url.search.slice(1),
    REQUEST_METHOD: c.req.method,
    CONTENT_TYPE: c.req.header("Content-Type") ?? "",
    REMOTE_USER,
    // Identity for the pre-receive hook: the authenticated token's owner.
    // SIGIT_SERVER_PUSH marks pushes performed by the server itself (PR merge
    // via worktree), which bypass the hook's direct-push checks - those are
    // enforced in the API instead (approvals, merge whitelist, admin bypass).
    GITPUSH_USER_ID: token?.userId ?? "",
    SIGIT_SERVER_PUSH: token ? "" : "1",
  };

  const child = spawn("git", ["http-backend"], { env });

  // Request body -> child stdin (the git client sends the packfile for receive-pack)
  const reqBody = c.req.raw.body;
  if (reqBody) {
    const nodeStream = Readable.fromWeb(reqBody as unknown as import("node:stream/web").ReadableStream);
    nodeStream.pipe(child.stdin);
  } else {
    child.stdin.end();
  }

  const childStdout = Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>;
  const { status, headers, body } = await parseCgiHeaders(childStdout);

  // Backup AFTER receive-pack completes: http-backend writes the headers
  // before refs are updated, so the trigger must wait for child close (not
  // for the header) - otherwise the bundle is created from an empty repo.
  const isReceivePack = c.req.method === "POST" && pathInfo.endsWith("/git-receive-pack");
  if (isReceivePack) {
    child.on("close", (code) => {
      audit(AUDIT_EVENTS.GIT_PUSH, { projectId: project.id, projectName: project.name, result: code === 0 ? "accepted" : "failed" });
      if (code === 0) {
        backupWithRetry(project);
        // A push may have moved a base or head branch, so the stored
        // trial-merge results of open PRs can be stale. Refresh them
        // fire-and-forget (any failure only degrades to "unknown").
        refreshOpenPrMergeability(project.id, projectRepoPath(project.id)).catch((err) => {
          log.error("mergeable", "PR mergeability refresh after push failed", { projectId: project.id, error: err instanceof Error ? err.message : String(err) });
        });
      }
    });
  }

  return new Response(body, { status, headers });
}
