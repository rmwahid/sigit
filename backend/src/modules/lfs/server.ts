import type { Project } from "../../db/schema/projects";
import { getObject, putObject, objectSize, deleteObject } from "../storage/objects";
import { log, audit } from "../../lib/logger";
import { sha256 } from "./index";
import type { StorageConnection } from "../../db/schema/storage";

export type LfsOperation = "download" | "upload";
export type LfsObject = { oid: string; size: number };

export const OID_RE = /^[a-f0-9]{64}$/;

// Path objek di storage user: projects/{id}/lfs/{oid} (kontrak AGENTS.md).
export function lfsObjectKey(projectId: string, oid: string): string {
  return `projects/${projectId}/lfs/${oid}`;
}

// Cek keberadaan objek tanpa men-download kontennya (HeadObject).
export async function objectExists(connection: StorageConnection, projectId: string, oid: string): Promise<boolean> {
  return (await objectSize(connection, lfsObjectKey(projectId, oid))) !== null;
}

// Verifikasi sha256(konten) == oid SEBELUM disimpan — aturan SiGit: server
// tidak menyimpan objek yang oid-nya tidak cocok dengan isinya.
export function verifyLfsContent(buffer: Buffer, oid: string): boolean {
  return sha256(buffer) === oid;
}

export function isValidOid(oid: string): boolean {
  return OID_RE.test(oid);
}

export type BatchOptions = {
  operation: LfsOperation;
  objects: LfsObject[];
  // Base URL action: {origin}/projects/<nama>.git/info/lfs/objects
  baseUrl: string;
  // Cek keberadaan objek (untuk operation download). Di-inject agar logika
  // murni bisa di-unit-test tanpa S3.
  exists?: (oid: string) => Promise<boolean>;
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

// Git LFS batch API (spec v1): client minta action untuk tiap oid.
// - download: action hanya diberikan kalau objek sudah ada di storage.
// - upload: action upload + verify selalu diberikan; konten diverifikasi
//   saat PUT (oid) dan verify (size).
export async function buildBatchResponse(opts: BatchOptions): Promise<BatchResponse> {
  const objects: BatchResponse["objects"] = [];
  for (const obj of opts.objects) {
    const entry: BatchResponse["objects"][number] = {
      oid: obj.oid,
      size: obj.size,
      authenticated: true,
    };
    if (opts.operation === "upload") {
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
  audit("lfs.download", { projectId: project.id, oid });
  return getObject(connection, key);
}

// Simpan objek LFS: verifikasi oid dulu, lalu putObject ke storage user.
export async function uploadObject(
  project: Project,
  connection: StorageConnection,
  oid: string,
  content: Buffer
): Promise<{ ok: boolean; error?: string }> {
  if (!verifyLfsContent(content, oid)) {
    return { ok: false, error: "oid mismatch: sha256(content) != oid" };
  }
  await putObject(connection, lfsObjectKey(project.id, oid), content);
  audit("lfs.upload", { projectId: project.id, oid, size: content.length });
  return { ok: true };
}

// Verify step (spec): objek ada DAN ukuran sesuai yang diklaim client.
// Kalau tidak cocok, objek dihapus agar storage tidak menampung sampah.
export async function verifyObject(
  project: Project,
  connection: StorageConnection,
  oid: string,
  size: number
): Promise<{ ok: boolean; error?: string }> {
  const key = lfsObjectKey(project.id, oid);
  const actual = await objectSize(connection, key);
  if (actual === null) {
    return { ok: false, error: "object does not exist" };
  }
  if (actual !== size) {
    try {
      await deleteObject(connection, key);
    } catch (err) {
      // objek salah tetap boleh tertinggal di storage, bukan kondisi fatal
      log.error("lfs", `failed to delete mismatched object ${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { ok: false, error: "size mismatch: stored size != declared size" };
  }
  return { ok: true };
}
