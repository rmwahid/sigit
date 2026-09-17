import { CONTENT_TYPE_OCTET_STREAM } from "@/constants/protocol";
import { ERROR_CODES } from "@/constants/errors";
import { getConnection } from "@/modules/storage/connections";
import { getDecrypted, putEncrypted } from "@/modules/encryption/at-rest";
import { getObject, objectMeta } from "@/modules/storage/objects";
import { projectRepoPath } from "./projects";
import { execGit, gitErrorMessage, initRepo } from "./git";
import { HttpError } from "@/lib/http-error";
import { log } from "@/lib/logger";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Project } from "@/db/schema/projects";
import type { StorageConnection } from "@/db/schema/storage";

// S3 object metadata key that stores the repo HEAD sha the bundle was created
// from (backupProject). Used by the restore guard to reject restoring a bundle
// that is behind the local repo (which would silently delete newer commits).
export const BUNDLE_HEAD_METADATA = "x-sigit-bundle-head";

// Key of the backup bundle in user storage (AGENTS.md contract).
export function backupObjectKey(projectId: string): string {
  return `projects/${projectId}/backup.bundle`;
}

export async function createBundle(project: Project): Promise<Buffer> {
  const repoPath = projectRepoPath(project.id);
  const tmpFile = path.join(os.tmpdir(), `${project.id}.bundle`);
  await execGit(repoPath, ["bundle", "create", tmpFile, "--all"]);
  const buffer = await fs.readFile(tmpFile);
  await fs.unlink(tmpFile).catch(() => {});
  return buffer;
}

// HEAD sha of the repo (null when the repo has no commits yet).
async function repoHead(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execGit(repoPath, ["rev-parse", "--verify", "HEAD"]);
    return stdout.toString("utf8").trim() || null;
  } catch {
    return null;
  }
}

export async function backupProject(project: Project): Promise<{ key: string; size: number; head: string | null }> {
  if (!project.storageConnectionId) throw new Error("Project has no storage connection");
  const connection = await getConnection(project.storageConnectionId);
  if (!connection) throw new Error("Storage connection not found");

  const bundle = await createBundle(project);
  const key = backupObjectKey(project.id);
  const head = await repoHead(projectRepoPath(project.id));
  const metadata: Record<string, string> = {};
  if (head) metadata[BUNDLE_HEAD_METADATA] = head;
  await putEncrypted(project, connection, key, bundle, CONTENT_TYPE_OCTET_STREAM, metadata);
  return { key, size: bundle.length, head };
}

// Information about the stored backup bundle, or null when there is no bundle
// (or its metadata cannot be read - treated as "unknown" rather than blocking
// the restore in that case).
export async function getStoredBackupInfo(
  project: Project,
  connection: StorageConnection
): Promise<{ head: string | null; storedAt: string | null } | null> {
  const key = backupObjectKey(project.id);
  const meta = await objectMeta(connection, key);
  if (!meta) return null;
  const head = meta.metadata[BUNDLE_HEAD_METADATA] ?? null;
  return { head, storedAt: meta.metadata.lastModified ?? null };
}

// Guards restoring from a bundle that is BEHIND the local repo: restoring it
// would overwrite the local history with an older state and silently delete
// commits that were pushed after the bundle was created (e.g. while the
// storage was down). Throws HttpError 409 RESTORE_BEHIND when the bundle
// does not contain the current local HEAD.
export async function assertBundleNotBehindLocal(
  project: Project,
  connection: StorageConnection
): Promise<void> {
  const info = await getStoredBackupInfo(project, connection);
  if (!info?.head) return; // no bundle metadata: cannot compare, allow restore
  const localHead = await repoHead(projectRepoPath(project.id));
  if (!localHead || localHead === info.head) return;

  // The bundle was created with `--all`, so its heads are the tips of all
  // branches at backup time. If the local HEAD is not among them, the local
  // repo has commits the bundle does not know - restoring would delete them.
  const bundle = await getDecrypted(project, connection, backupObjectKey(project.id));
  const tmpFile = path.join(os.tmpdir(), `${project.id}-guard.bundle`);
  await fs.writeFile(tmpFile, bundle);
  try {
    const { stdout } = await execGit(path.dirname(tmpFile), ["bundle", "list-heads", tmpFile]);
    const bundleHeads = new Set(
      stdout
        .toString("utf8")
        .split("\n")
        .map((l) => l.trim().split(/\s+/)[0])
        .filter(Boolean)
    );
    if (!bundleHeads.has(localHead)) {
      throw new HttpError(
        409,
        ERROR_CODES.RESTORE_BEHIND,
        "The stored backup is older than the current local history. Restoring would delete commits made after the last successful backup. Reconnect storage and push first, or restore only when you want to discard local history."
      );
    }
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

export async function restoreProject(
  project: Project,
  connection: StorageConnection
): Promise<void> {
  const key = backupObjectKey(project.id);
  const bundle = await getDecrypted(project, connection, key);
  const repoPath = projectRepoPath(project.id);
  const tmpFile = path.join(os.tmpdir(), `${project.id}-restore.bundle`);
  await fs.writeFile(tmpFile, bundle);
  try {
    await fs.rm(repoPath, { recursive: true, force: true });
    await fs.mkdir(repoPath, { recursive: true });
    await execGit(repoPath, ["clone", tmpFile, "."]);
    await initRepo(repoPath, project.lfsSizeThreshold);
  } catch (err) {
    log.error("restore", "restoreProject failed", {
      projectId: project.id,
      error: gitErrorMessage(err),
    });
    throw err;
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

// Reads the bundle payload directly (bypasses putEncrypted/getDecrypted) -
// used by tests to inspect stored bundles without decrypting.
export async function readStoredBundle(
  project: Project,
  connection: StorageConnection
): Promise<Buffer> {
  return getObject(connection, backupObjectKey(project.id));
}
