import { AUDIT_EVENTS } from "@/constants/audit-events";
import { MAX_LFS_OBJECT_BYTES } from "@/constants/limits";
import { objectMeta, objectSize } from "@/modules/storage/objects";
import { PLAINTEXT_SIZE_METADATA, getDecrypted, putEncrypted } from "@/modules/encryption/at-rest";
import { audit, log } from "@/lib/logger";
import { sha256 } from "@/lib/hash";
import { LFS_MESSAGES } from "@/constants/lfs-messages";
import type { Project } from "@/db/schema/projects";
import type { StorageConnection } from "@/db/schema/storage";

export type LfsOperation = "download" | "upload";
export type LfsObject = { oid: string; size: number };

export const OID_RE = /^[a-f0-9]{64}$/;

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

export type DownloadResult = { ok: true; content: Buffer } | { ok: false; reason: "missing" | "too_large" };

// Reads a stored object. The size gate uses the same per-object bound the upload
// route enforces, so an object the server would refuse to accept can never cost
// more than that bound to serve. The size comes from the plaintext metadata
// written by putEncrypted; the ciphertext ContentLength is 28 bytes larger.
export async function downloadObject(
  project: Project,
  connection: StorageConnection,
  oid: string
): Promise<DownloadResult> {
  const key = lfsObjectKey(project.id, oid);
  const meta = await objectMeta(connection, key);
  if (!meta) return { ok: false, reason: "missing" };
  const plaintextSize = Number(meta.metadata[PLAINTEXT_SIZE_METADATA] ?? meta.size);
  if (plaintextSize > MAX_LFS_OBJECT_BYTES) return { ok: false, reason: "too_large" };
  audit(AUDIT_EVENTS.LFS_DOWNLOAD, { projectId: project.id, oid, size: plaintextSize });
  return { ok: true, content: await getDecrypted(project, connection, key) };
}

// Stores an LFS object: verify the oid first, then putObject (encrypted) to user storage.
export async function uploadObject(
  project: Project,
  connection: StorageConnection,
  oid: string,
  content: Buffer
): Promise<{ ok: boolean; error?: string }> {
  if (!verifyLfsContent(content, oid)) {
    return { ok: false, error: LFS_MESSAGES.OID_MISMATCH };
  }
  await putEncrypted(project, connection, lfsObjectKey(project.id, oid), content);
  audit(AUDIT_EVENTS.LFS_UPLOAD, { projectId: project.id, oid, size: content.length });
  return { ok: true };
}

// Verify step (spec): object exists AND size matches what the client claimed.
// The stored size is the plaintext size from metadata (set by putEncrypted);
// it falls back to ContentLength for legacy plaintext objects.
// A mismatch means the upload did not complete correctly, so the step reports it
// and leaves the stored object alone. The declared size is asserted by the
// caller, and deleting on that basis would let any reader of a project destroy
// stored content; a genuine orphan is reclaimed by an operator sweep instead.
export async function verifyObject(
  project: Project,
  connection: StorageConnection,
  oid: string,
  size: number
): Promise<{ ok: boolean; error?: string }> {
  const key = lfsObjectKey(project.id, oid);
  const meta = await objectMeta(connection, key);
  if (!meta) {
    return { ok: false, error: LFS_MESSAGES.OBJECT_DOES_NOT_EXIST };
  }
  const plaintextSize = Number(meta.metadata[PLAINTEXT_SIZE_METADATA] ?? meta.size);
  if (plaintextSize !== size) {
    log.warn("lfs", `verify size mismatch for ${key}`, { stored: plaintextSize, declared: size });
    return { ok: false, error: LFS_MESSAGES.SIZE_MISMATCH };
  }
  return { ok: true };
}
