import { CONTENT_TYPE_OCTET_STREAM } from "../../constants/protocol";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getConnection } from "../storage/connections";
import { getDecrypted, putEncrypted } from "../encryption/at-rest";
import { projectRepoPath } from "./projects";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Project } from "../../db/schema/projects";
import type { StorageConnection } from "../../db/schema/storage";

const execAsync = promisify(exec);

export async function createBundle(project: Project): Promise<Buffer> {
  const repoPath = projectRepoPath(project.id);
  const tmpFile = path.join(os.tmpdir(), `${project.id}.bundle`);
  await execAsync(`git bundle create "${tmpFile}" --all`, { cwd: repoPath });
  const buffer = await fs.readFile(tmpFile);
  await fs.unlink(tmpFile).catch(() => {});
  return buffer;
}

export async function backupProject(project: Project): Promise<{ key: string; size: number }> {
  if (!project.storageConnectionId) throw new Error("Project has no storage connection");
  const connection = await getConnection(project.storageConnectionId);
  if (!connection) throw new Error("Storage connection not found");

  const bundle = await createBundle(project);
  const key = `projects/${project.id}/backup.bundle`;
  await putEncrypted(project, connection, key, bundle, CONTENT_TYPE_OCTET_STREAM);
  return { key, size: bundle.length };
}

export async function restoreProject(
  project: Project,
  connection: StorageConnection
): Promise<void> {
  const key = `projects/${project.id}/backup.bundle`;
  const bundle = await getDecrypted(project, connection, key);
  const repoPath = projectRepoPath(project.id);
  const tmpFile = path.join(os.tmpdir(), `${project.id}-restore.bundle`);
  await fs.writeFile(tmpFile, bundle);
  try {
    await fs.rm(repoPath, { recursive: true, force: true });
    await fs.mkdir(repoPath, { recursive: true });
    await execAsync(`git clone "${tmpFile}" .`, { cwd: repoPath });
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}
