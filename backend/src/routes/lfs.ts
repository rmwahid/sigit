import { CONTENT_TYPE_LFS_JSON, CONTENT_TYPE_OCTET_STREAM } from "@/constants/protocol";
import { Hono } from "hono";
import { requireGitToken } from "@/middleware/git-auth";
import { getProjectByName, projectNameFromRouteParam } from "@/modules/projects/projects";
import { getConnection } from "@/modules/storage/connections";
import { scopeAllows, scopeForLfsOperation } from "@/modules/auth/scopes";
import { log } from "@/lib/logger";
import { MAX_LFS_BATCH_OBJECTS, MAX_LFS_OBJECT_BYTES } from "@/constants/limits";
import { LFS_MESSAGES } from "@/constants/lfs-messages";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  buildBatchResponse,
  downloadObject,
  isValidOid,
  objectExists,
  uploadObject,
  verifyObject,
  type LfsObject,
} from "@/modules/lfs/server";
import type { Project } from "@/db/schema/projects";
import type { StorageConnection } from "@/db/schema/storage";

// Git LFS server API (spec v1, basic transfer):
//   POST /projects/<name>.git/info/lfs/objects/batch   -> action hrefs
//   PUT  /projects/<name>.git/info/lfs/objects/:oid    -> upload content
//   POST /projects/<name>.git/info/lfs/objects/:oid/verify -> verify size
//   GET  /projects/<name>.git/info/lfs/objects/:oid    -> download content
// Objects are stored in USER STORAGE (not server disk): projects/{id}/lfs/{oid}.
// Must be mounted BEFORE gitRoutes (catch-all .git) in index.ts.
export const lfsRoutes = new Hono();

// LFS errors follow the spec: JSON { message } - NOT the { error: { code } } format.
// Built directly (not HttpError) so the global onError does not wrap them.
class LfsError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    message: string
  ) {
    super(message);
  }
}

function lfsError(c: Context, status: ContentfulStatusCode, message: string): Response {
  return c.json({ message }, status, { "Content-Type": CONTENT_TYPE_LFS_JSON });
}

async function loadProject(name: string): Promise<Project> {
  const project = await getProjectByName(name);
  if (!project) throw new LfsError(404, "Not found");
  return project;
}

async function loadConnection(project: Project): Promise<StorageConnection> {
  if (!project.storageConnectionId) throw new LfsError(404, "Not found");
  const connection = await getConnection(project.storageConnectionId);
  if (!connection) throw new LfsError(404, "Not found");
  return connection;
}

// Handler terpusat: LfsError -> status/message spec; error lain -> log + 500.
async function guard(c: Context, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof LfsError) return lfsError(c, err.status, err.message);
    log.error("lfs", err instanceof Error ? err.message : String(err));
    return lfsError(c, 500, "Internal error");
  }
}

lfsRoutes.post("/:name{.+\.git}/info/lfs/objects/batch", requireGitToken, async (c) => {
  const name = projectNameFromRouteParam(c.req.param("name"));
  return guard(c, async () => {
    const body = await c.req.json().catch(() => null);
    if (!body || (body.operation !== "download" && body.operation !== "upload") || !Array.isArray(body.objects)) {
      throw new LfsError(422, "Invalid batch request");
    }
    const objects: LfsObject[] = body.objects;
    if (objects.length === 0 || objects.length > MAX_LFS_BATCH_OBJECTS || !objects.every(isValidBatchObject)) {
      throw new LfsError(422, "Invalid batch objects");
    }
    if (Array.isArray(body.transfers) && body.transfers.length > 0 && !body.transfers.includes("basic")) {
      throw new LfsError(422, "Unsupported transfer: only basic is supported");
    }
    // Scope check AFTER the project is resolved: the middleware only sets
    // tokenScope when the project exists (missing project -> handler 404, not 403).
    const project = await loadProject(name);
    const required = scopeForLfsOperation(body.operation);
    if (!scopeAllows(c.get("tokenScope"), required)) {
      throw new LfsError(403, `Token requires "${required}" scope for ${body.operation}`);
    }
    const connection = await loadConnection(project);
    const origin = new URL(c.req.url).origin;
    const baseUrl = `${origin}/projects/${encodeURIComponent(name)}.git/info/lfs/objects`;
    const payload = await buildBatchResponse({
      operation: body.operation,
      objects,
      baseUrl,
      exists: async (oid) => (await objectExists(connection, project.id, oid)) !== false,
      maxObjectBytes: MAX_LFS_OBJECT_BYTES,
    });
    return c.json(payload, 200, { "Content-Type": CONTENT_TYPE_LFS_JSON });
  });
});

lfsRoutes.get("/:name{.+\.git}/info/lfs/objects/:oid", requireGitToken, async (c) => {
  const name = projectNameFromRouteParam(c.req.param("name"));
  const oid = c.req.param("oid") ?? "";
  return guard(c, async () => {
    if (!isValidOid(oid)) throw new LfsError(422, "Invalid oid");
    const project = await loadProject(name);
    const connection = await loadConnection(project);
    const content = await downloadObject(project, connection, oid);
    if (!content) throw new LfsError(404, "Object does not exist");
    return new Response(new Uint8Array(content), { headers: { "Content-Type": CONTENT_TYPE_OCTET_STREAM } });
  });
});

lfsRoutes.put("/:name{.+\.git}/info/lfs/objects/:oid", requireGitToken, async (c) => {
  const name = projectNameFromRouteParam(c.req.param("name"));
  const oid = c.req.param("oid") ?? "";
  return guard(c, async () => {
    if (!isValidOid(oid)) throw new LfsError(422, "Invalid oid");
    const project = await loadProject(name);
    const connection = await loadConnection(project);
    // Limit the body size: pre-check Content-Length + stream with a cap
    // (a client can lie about Content-Length, so the cap is also enforced while reading).
    const declared = Number(c.req.header("Content-Length") ?? "0");
    if (declared > MAX_LFS_OBJECT_BYTES) {
      throw new LfsError(413, `Object exceeds the ${MAX_LFS_OBJECT_BYTES} byte limit`);
    }
    const content = await readBodyWithLimit(c, MAX_LFS_OBJECT_BYTES);
    if (!content) {
      throw new LfsError(413, `Object exceeds the ${MAX_LFS_OBJECT_BYTES} byte limit`);
    }
    if (content.length === 0) throw new LfsError(422, "Empty object body");
    const result = await uploadObject(project, connection, oid, content);
    if (!result.ok) throw new LfsError(422, result.error ?? "Upload failed");
    return new Response(null, { status: 200 });
  });
});

lfsRoutes.post("/:name{.+\.git}/info/lfs/objects/:oid/verify", requireGitToken, async (c) => {
  const name = projectNameFromRouteParam(c.req.param("name"));
  const oid = c.req.param("oid") ?? "";
  return guard(c, async () => {
    if (!isValidOid(oid)) throw new LfsError(422, "Invalid oid");
    const body = await c.req.json().catch(() => null);
    const size = typeof body?.size === "number" && Number.isInteger(body.size) ? body.size : -1;
    if (size < 0 || body?.oid !== oid) throw new LfsError(422, "Invalid verify request");
    const project = await loadProject(name);
    const connection = await loadConnection(project);
    const result = await verifyObject(project, connection, oid, size);
    if (!result.ok) {
      throw new LfsError(result.error === LFS_MESSAGES.OBJECT_DOES_NOT_EXIST ? 404 : 422, result.error ?? "Verify failed");
    }
    return new Response(null, { status: 200 });
  });
});

function isValidBatchObject(obj: unknown): obj is LfsObject {
  const o = obj as LfsObject;
  return (
    !!o &&
    isValidOid(o.oid) &&
    typeof o.size === "number" &&
    Number.isInteger(o.size) &&
    o.size >= 0
  );
}

// Streams the request body with a byte limit; returns null when the limit is
// exceeded (prevents unbounded uploads from exhausting server memory).
async function readBodyWithLimit(c: Context, maxBytes: number): Promise<Buffer | null> {
  const reader = c.req.raw.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
