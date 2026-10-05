import { CONTENT_TYPE_OCTET_STREAM } from "@/constants/protocol";
import { MAX_BACKUP_BUNDLE_BYTES } from "@/constants/limits";
import { ERROR_CODES } from "@/constants/errors";
import { getConnection } from "@/modules/storage/connections";
import { getDecrypted, putEncrypted } from "@/modules/encryption/at-rest";
import { ObjectTooLargeError, getObject, objectMeta } from "@/modules/storage/objects";
import { projectRepoPath } from "./projects";
import { env } from "@/config/env";
import { execGit, gitErrorMessage, initRepo } from "./git";
import { HttpError } from "@/lib/http-error";
import { log } from "@/lib/logger";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Project } from "@/db/schema/projects";
import type { StorageConnection } from "@/db/schema/storage";

// Resolved because the scratch path is passed to git, which resolves a relative
// path against the repository it runs in (see PROJECTS_ROOT in modules/git/server.ts).
const PROJECTS_ROOT = path.resolve(env.SIGIT_PROJECTS_ROOT);

// S3 object metadata key that stores the repo HEAD sha the bundle was created
// from (backupProject). Used by the restore guard to reject restoring a bundle
// that is behind the local repo (which would silently delete newer commits).
export const BUNDLE_HEAD_METADATA = "x-sigit-bundle-head";

// Key of the backup bundle in user storage (AGENTS.md contract).
export function backupObjectKey(projectId: string): string {
  return `projects/${projectId}/backup.bundle`;
}

export class BundleTooLargeError extends Error {
  constructor(public readonly size: number, public readonly limit: number) {
    super(`Repository bundle is ${size} bytes, above the ${limit} byte limit`);
    this.name = "BundleTooLargeError";
  }
}

// Scratch path for a bundle file. It lives on the projects volume rather than in
// the OS temp directory (a tmpfs in the container deployment, where the file is
// charged to the container memory limit as well) and carries a random suffix, so
// two operations on one project never collide on the same name.
function scratchPath(projectId: string, label: string): string {
  return path.join(PROJECTS_ROOT, `.bundle-${projectId}-${crypto.randomUUID()}-${label}`);
}

export async function createBundle(project: Project): Promise<Buffer> {
  const repoPath = projectRepoPath(project.id);
  // One file per attempt: two accepted pushes on one project run their backup at
  // the same time, and a fixed path made them collide on git's own lock file, so
  // the push that lost the race never refreshed the stored backup.
  //
  // The bundle is written next to the repositories rather than in the OS temp
  // directory: os.tmpdir() is a tmpfs in the container deployment, so every byte
  // of the bundle would be charged to the container's memory limit as well for
  // as long as the file exists.
  const tmpFile = scratchPath(project.id, "create");
  await execGit(repoPath, ["bundle", "create", tmpFile, "--all"]);
  // The bundle is the whole repository history in one file and nothing in the
  // tree bounds a repository's total size (the hook bounds single blobs), so the
  // only place to keep it from being buffered into the shared process is here:
  // refuse it instead of reading a file the container cannot afford to hold.
  const { size } = await fs.stat(tmpFile);
  if (size > MAX_BACKUP_BUNDLE_BYTES) {
    await fs.unlink(tmpFile).catch(() => {});
    throw new BundleTooLargeError(size, MAX_BACKUP_BUNDLE_BYTES);
  }
  const buffer = await fs.readFile(tmpFile);
  await fs.unlink(tmpFile).catch(() => {});
  return buffer;
}

// Reads the stored bundle under the server cap. The storage layer raises
// ObjectTooLargeError when the object is bigger than the cap (the destination
// decides that, not this server), and the admin who pressed Restore should see
// why nothing happened instead of a 500.
async function readBundleWithinLimit(project: Project, connection: StorageConnection): Promise<Buffer> {
  try {
    return await getDecrypted(project, connection, backupObjectKey(project.id), MAX_BACKUP_BUNDLE_BYTES);
  } catch (err) {
    if (err instanceof ObjectTooLargeError) {
      throw new HttpError(
        413,
        ERROR_CODES.BAD_REQUEST,
        `The stored backup is larger than the ${MAX_BACKUP_BUNDLE_BYTES} byte limit this server enforces; nothing was restored`
      );
    }
    throw err;
  }
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

// Guards restoring from a bundle that does not contain the local history:
// restoring rebuilds the repository from the bundle alone, so every local ref
// the bundle cannot reach would be deleted. Throws HttpError 409 RESTORE_BEHIND
// and names the refs at risk.
//
// The check is containment (not equality) and it covers EVERY local ref: the
// old form compared only HEAD against the bundle tips, so a branch other than
// HEAD could be dropped silently. It also runs when the stored bundle carries
// no head metadata, because being unable to compare is not a reason to allow a
// destructive restore.
export async function assertBundleNotBehindLocal(
  project: Project,
  connection: StorageConnection
): Promise<void> {
  const repoPath = projectRepoPath(project.id);
  const localRefs = await refShas(repoPath);
  if (localRefs.length === 0) return; // empty repository: nothing to lose
  // No stored object at all: the restore itself fails later, with its own error.
  if (!(await getStoredBackupInfo(project, connection))) return;

  const bundle = await readBundleWithinLimit(project, connection);
  const tmpFile = scratchPath(project.id, "guard.bundle");
  await fs.writeFile(tmpFile, bundle);
  // A scratch repository that holds only the bundle objects, so "contained in
  // the backup" is exactly what git can answer about the local commits.
  const scratch = scratchPath(project.id, "guard-check");
  await fs.rm(scratch, { recursive: true, force: true });
  await initRepo(scratch);
  try {
    await execGit(scratch, ["fetch", tmpFile, "+refs/*:refs/*"]);
    const tips = (await refShas(scratch)).map((ref) => ref.sha);
    const atRisk: string[] = [];
    for (const ref of localRefs) {
      if (!(await containedInAny(scratch, ref.sha, tips))) atRisk.push(`${ref.name} (${ref.sha.slice(0, 12)})`);
    }
    if (atRisk.length > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.RESTORE_BEHIND,
        `The stored backup does not contain ${atRisk.length === 1 ? "this local ref" : "these local refs"}: ${atRisk.join(", ")}. Restoring would delete those commits. Push first, or restore only when you want to discard them.`
      );
    }
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}

// Local refs with the commit each one points at. Tags are dereferenced: an
// annotated tag object is not a commit, so comparing it directly would report a
// tag as missing from a backup that does contain its commit.
async function refShas(repoPath: string): Promise<{ name: string; sha: string }[]> {
  const { stdout } = await execGit(repoPath, [
    "for-each-ref",
    "--format=%(refname:short) %(*objectname) %(objectname)",
    "refs/heads",
    "refs/tags",
  ]);
  return stdout
    .toString("utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, peeled, raw] = line.split(" ");
      return { name, sha: peeled || raw };
    });
}

// True when git can reach sha from one of the given tips inside that repository.
async function containedInAny(repoPath: string, sha: string, tips: string[]): Promise<boolean> {
  for (const tip of tips) {
    try {
      await execGit(repoPath, ["merge-base", "--is-ancestor", sha, tip]);
      return true;
    } catch {
      // not an ancestor of this tip, or unknown to this repository: try the next
    }
  }
  return false;
}

export async function restoreProject(
  project: Project,
  connection: StorageConnection
): Promise<void> {
  const bundle = await readBundleWithinLimit(project, connection);
  const repoPath = projectRepoPath(project.id);
  const tmpFile = scratchPath(project.id, "restore.bundle");
  await fs.writeFile(tmpFile, bundle);
  try {
    await fs.rm(repoPath, { recursive: true, force: true });
    // Rebuild the bare repo FIRST and import the bundle into it, so the
    // project directory stays the git dir. Cloning the bundle into the project
    // directory instead produced a non-bare repository whose real git dir was
    // <repoPath>/.git: git reads hooks from the effective git dir, so the
    // generated pre-receive hook at <repoPath>/hooks/pre-receive was never
    // executed and the LFS size gate and every branch protection rule were
    // silently off for the restored project. initRepo also installs the hook,
    // so it must run before the refs arrive.
    await initRepo(repoPath, project.lfsSizeThreshold);
    await execGit(repoPath, ["fetch", tmpFile, "+refs/*:refs/*"]);
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
