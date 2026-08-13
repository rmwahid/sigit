import { AUDIT_EVENTS } from "../../constants/audit-events";
import { deleteObject, objectMeta, objectSize } from "../storage/objects";
import { PLAINTEXT_SIZE_METADATA, getDecrypted, putEncrypted } from "../encryption/at-rest";
import { audit, log } from "../../lib/logger";
import { sha256 } from "./index";
import type { Project } from "../../db/schema/projects";
import type { StorageConnection } from "../../db/schema/storage";

export type LfsOperation = "download" | "upload";
export type LfsObject = { oid: string; size: number };

export const OID_RE = /^[a-f0-9]{64}$/;

// Batas ukuran objek LFS (2 GiB). Satu sumber kebenaran - dipakai route PUT
// (penolakan body) dan batch builder (action upload tidak ditawarkan).
export const MAX_LFS_OBJECT_BYTES = 2 * 1024 * 1024 * 1024;

// Object path in user storage: projects/{id}/lfs/{oid} (AGENTS.md contract).
export function lfsObjectKey(projectId: string, oid: string): string {
  return `projects/${projectId}/lfs/${oid}`;
}

// Checks object existence without downloading its content (HeadObject).
export async function objectExists(connection: StorageConnection, projectId: string, oid: string): Promise<boolean> {
  return (await objectSize(connection, lfsObjectKey(projectId, oid))) !== null;
}

// Verifies sha256(content) == oid BEFORE storing - SiGit rule: the server
// never stores an object whose oid does not match its content.
export function verifyLfsContent(buffer: Buffer, oid: string): boolean {
  return sha256(buffer) === oid;
}

export function isValidOid(oid: string): boolean {
  return OID_RE.test(oid);
}

export type BatchOptions = {
  operation: LfsOperation;
  objects: LfsObject[];
  // Action base URL: {origin}/projects/<name>.git/info/lfs/objects
  baseUrl: string;
  // Object existence check (for the download operation). Injected so the pure
  // logic can be unit-tested without S3.
  exists?: (oid: string) => Promise<boolean>;
  // Max object size in bytes; upload action is omitted for larger objects.
  maxObjectBytes?: number;
};

export type BatchResponse = {
  transfer: "basic";
  objects: {
    oid: string;
    size: number;
    authenticated: boolean;
    actions?: { download?: { href: string }; upload?: { href: string }; verify?: { href: string } };
  }[];
};

// Git LFS batch API (spec v1): the client asks for actions per oid.
// - download: action is only given when the object already exists in storage.
// - upload: upload + verify actions are always given; content is verified
//   at PUT (oid) and verify (size).
export async function buildBatchResponse(opts: BatchOptions): Promise<BatchResponse> {
  const objects: BatchResponse["objects"] = [];
  for (const obj of opts.objects) {
    const entry: BatchResponse["objects"][number] = {
      oid: obj.oid,
      size: obj.size,
      authenticated: true,
    };
    if (opts.operation === "upload") {
      if (opts.maxObjectBytes !== undefined && obj.size > opts.maxObjectBytes) {
        // Object exceeds the server limit: do not offer an upload action.
        objects.push(entry);
        continue;
      }
      const href = `${opts.baseUrl}/${obj.oid}`;
      entry.actions = {
        upload: { href },
        verify: { href: `${href}/verify` },
      };
    } else if (opts.exists) {
      const exists = await opts.exists(obj.oid);
      if (exists) {
        entry.actions = { download: { href: `${opts.baseUrl}/${obj.oid}` } };
      }
    }
    objects.push(entry);
  }
  return { transfer: "basic", objects };
}

export async function downloadObject(
  project: Project,
  connection: StorageConnection,
  oid: string
): Promise<Buffer | null> {
  const key = lfsObjectKey(project.id, oid);
  if ((await objectSize(connection, key)) === null) return null;
  audit(AUDIT_EVENTS.LFS_DOWNLOAD, { projectId: project.id, oid });
  return getDecrypted(project, connection, key);
}

// Stores an LFS object: verify the oid first, then putObject (encrypted) to user storage.
export async function uploadObject(
  project: Project,
  connection: StorageConnection,
  oid: string,
  content: Buffer
): Promise<{ ok: boolean; error?: string }> {
  if (!verifyLfsContent(content, oid)) {
    return { ok: false, error: "oid mismatch: sha256(content) != oid" };
  }
  await putEncrypted(project, connection, lfsObjectKey(project.id, oid), content);
  audit(AUDIT_EVENTS.LFS_UPLOAD, { projectId: project.id, oid, size: content.length });
  return { ok: true };
}

// Verify step (spec): object exists AND size matches what the client claimed.
// The stored size is the plaintext size from metadata (set by putEncrypted);
// it falls back to ContentLength for legacy plaintext objects.
// On mismatch the object is deleted so storage does not accumulate garbage.
export async function verifyObject(
  project: Project,
  connection: StorageConnection,
  oid: string,
  size: number
): Promise<{ ok: boolean; error?: string }> {
  const key = lfsObjectKey(project.id, oid);
  const meta = await objectMeta(connection, key);
  if (!meta) {
    return { ok: false, error: "object does not exist" };
  }
  const plaintextSize = Number(meta.metadata[PLAINTEXT_SIZE_METADATA] ?? meta.size);
  if (plaintextSize !== size) {
    try {
      await deleteObject(connection, key);
    } catch (err) {
      // a wrong object may stay in storage; not a fatal condition
      log.error("lfs", `failed to delete mismatched object ${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { ok: false, error: "size mismatch: stored size != declared size" };
  }
  return { ok: true };
}
