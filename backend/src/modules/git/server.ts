import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import path from "node:path";
import type { Context } from "hono";
import { getProjectByName } from "../projects/projects";
import { backupProject } from "../projects/backup";
import { log } from "../../lib/logger";

const PROJECTS_ROOT = path.resolve(process.env.SIGIT_PROJECTS_ROOT ?? "./data/projects");

// git http-backend memakai konvensi CGI: baris header seperti
// "Status: 200 OK" + "Content-Type: ..." lalu \r\n\r\n dan body.
async function parseCgiHeaders(
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

  // Body stream: sisa header yang sudah terbaca + lanjutan dari reader asli.
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

export async function handleGitRequest(c: Context, projectName: string, pathInfo: string): Promise<Response> {
  const project = await getProjectByName(projectName);
  if (!project) return c.json({ error: { code: "NOT_FOUND", message: "Project not found" } }, 404);

  const url = new URL(c.req.url);
  // PATH_INFO pakai UUID (folder repo bare), URL tetap nama project.
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    GIT_PROJECT_ROOT: PROJECTS_ROOT,
    GIT_HTTP_EXPORT_ALL: "1",
    PATH_INFO: `/${project.id}${pathInfo}`,
    QUERY_STRING: url.search.slice(1),
    REQUEST_METHOD: c.req.method,
    CONTENT_TYPE: c.req.header("Content-Type") ?? "",
    REMOTE_USER: "sigit",
  };

  const child = spawn("git", ["http-backend"], { env });

  // Request body → child stdin (git client mengirim packfile untuk receive-pack)
  const reqBody = c.req.raw.body;
  if (reqBody) {
    const nodeStream = Readable.fromWeb(reqBody as unknown as import("node:stream/web").ReadableStream);
    nodeStream.pipe(child.stdin);
  } else {
    child.stdin.end();
  }

  const childStdout = Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>;
  const { status, headers, body } = await parseCgiHeaders(childStdout);

  // Backup otomatis SETELAH receive-pack selesai: http-backend menulis header
  // sebelum ref di-update, jadi trigger harus menunggu child close (bukan
  // setelah header) — kalau tidak, bundle dibuat dari repo yang masih kosong.
  const isReceivePack = c.req.method === "POST" && pathInfo.endsWith("/git-receive-pack");
  if (isReceivePack) {
    child.on("close", (code) => {
      if (code === 0) {
        backupProject(project).catch((err) => {
          log.error("backup", "auto backup after push failed", { projectId: project.id, error: err instanceof Error ? err.message : String(err) });
        });
      }
    });
  }

  return new Response(body, { status, headers });
}
