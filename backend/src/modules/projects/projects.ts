import { eq, sql } from "drizzle-orm";
import { db } from "@/config/db";
import { env } from "@/config/env";
import { projects, type NewProject, type Project } from "@/db/schema/projects";
import { createConnectionFromInput, getConnection } from "@/modules/storage/connections";
import { deleteObjectsByPrefix } from "@/modules/storage/objects";
import { getLog, initRepo, installPreReceiveHook, resolveHead } from "./git";
import { deleteRowById } from "@/lib/db";
import { HttpError } from "@/lib/http-error";
import { encryptSecret } from "@/lib/secret-encryption";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const PROJECTS_ROOT = env.SIGIT_PROJECTS_ROOT;

// Regenerates the pre-receive hook when a threshold change lands in the DB.
async function refreshPreReceiveHook(projectId: string, lfsSizeThreshold: number | undefined): Promise<void> {
  if (lfsSizeThreshold === undefined) return;
  await installPreReceiveHook(projectRepoPath(projectId), lfsSizeThreshold);
}

// Generates the per-project 32-byte key, wrapped with ENCRYPTION_KEYS (the
// at-rest layer). Only the encrypted ciphertext + key id reach the DB; the raw
// key is never stored anywhere.
function newProjectKey(): { encryptionKeyEncrypted: string; encryptionKeyId: string } {
  const raw = crypto.randomBytes(32).toString("hex");
  const wrapped = encryptSecret(raw);
  return { encryptionKeyEncrypted: wrapped.ciphertext, encryptionKeyId: wrapped.keyId };
}

export function projectRepoPath(projectId: string): string {
  return path.resolve(PROJECTS_ROOT, projectId);
}

export async function listProjects(): Promise<Project[]> {
  return db.select().from(projects);
}

export async function getProject(id: string): Promise<Project | undefined> {
  return db.query.projects.findFirst({ where: eq(projects.id, id) });
}

// Project names are unique CASE-INSENSITIVELY (NotesApp == notesapp is rejected),
// but the original casing is kept and used consistently in the URL.
// Spaces are not allowed (git URL /projects/<name>.git).
const PROJECT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*[A-Za-z0-9]$/;

// Project name from the git route param (/projects/<name>.git): strip the .git suffix.
// Single source of truth - all git/LFS routes use this, no inline replace.
export function projectNameFromRouteParam(param: string | undefined): string {
  return (param ?? "").replace(/\.git$/, "");
}

export async function getProjectByName(name: string): Promise<Project | undefined> {
  return db.query.projects.findFirst({
    where: eq(sql`lower(${projects.name})`, sql`lower(${name})`),
  });
}

export async function createProject(data: NewProject): Promise<Project> {
  if (!data.storageConnectionId) {
    throw new Error("Project storage connection is required");
  }
  await assertProjectNameAvailable(data.name);
  const inserted = await db.insert(projects).values({ ...data, ...newProjectKey() }).returning();
  const project = inserted[0];
  if (!project) throw new Error("Failed to create project");
  await initRepo(projectRepoPath(project.id), project.lfsSizeThreshold);
  return project;
}

async function assertProjectNameAvailable(name: string): Promise<void> {
  if (name.length < 2 || name.length > 64 || !PROJECT_NAME_RE.test(name)) {
    throw new HttpError(400, "INVALID_PROJECT_NAME", "Use letters, numbers, dashes, or underscores (no spaces, e.g. my-project or NotesApp)");
  }
  const existing = await getProjectByName(name);
  if (existing) {
    throw new HttpError(409, "PROJECT_NAME_TAKEN", `Project name "${name}" is already taken`);
  }
}

export type CreateProjectWithConnectionInput = {
  name: string;
  description?: string;
  connection: {
    name: string;
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    forcePathStyle?: boolean;
  };
};

export async function createProjectWithConnection(
  data: CreateProjectWithConnectionInput
): Promise<{ project: Project; connectionId: string }> {
  return db.transaction(async (tx) => {
    await assertProjectNameAvailable(data.name);
    const connection = await createConnectionFromInput(data.connection, tx);
    const projRows = await tx
      .insert(projects)
      .values({
        name: data.name,
        description: data.description,
        storageConnectionId: connection.id,
        ...newProjectKey(),
      })
      .returning();
    const project = projRows[0];
    if (!project) throw new Error("Failed to create project");

    await initRepo(projectRepoPath(project.id), project.lfsSizeThreshold);
    return { project, connectionId: connection.id };
  });
}

export async function updateProject(id: string, data: Partial<NewProject>): Promise<Project | undefined> {
  if (data.name) {
    if (data.name.length < 2 || data.name.length > 64 || !PROJECT_NAME_RE.test(data.name)) {
      throw new HttpError(400, "INVALID_PROJECT_NAME", "Use letters, numbers, dashes, or underscores (no spaces, e.g. my-project or NotesApp)");
    }
    const existing = await getProjectByName(data.name);
    if (existing && existing.id !== id) {
      throw new HttpError(409, "PROJECT_NAME_TAKEN", `Project name "${data.name}" is already taken`);
    }
  }
  // Encryption keys are write-once: never updatable through this path.
  const { encryptionKeyEncrypted: _key, encryptionKeyId: _keyId, ...safe } = data;
  const rows = await db
    .update(projects)
    .set({ ...safe, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning();
  const project = rows[0];
  if (project) {
    await refreshPreReceiveHook(project.id, safe.lfsSizeThreshold);
  }
  return project;
}

export async function deleteProject(id: string): Promise<boolean> {
  return deleteRowById(projects, id);
}

export type DeleteProjectResult = {
  deletedDb: boolean;
  deletedRepo: boolean;
  deletedS3Objects: number;
  hadStorage: boolean;
};

export async function hardDeleteProject(id: string): Promise<DeleteProjectResult> {
  // 1. Get project before deleting row (need storageConnectionId)
  const project = await getProject(id);
  const result: DeleteProjectResult = {
    deletedDb: false,
    deletedRepo: false,
    deletedS3Objects: 0,
    hadStorage: !!project?.storageConnectionId,
  };

  // 2. Delete local repo folder
  const repoPath = projectRepoPath(id);
  try {
    await fs.rm(repoPath, { recursive: true, force: true });
    result.deletedRepo = true;
  } catch {
    result.deletedRepo = false;
  }

  // 3. Delete S3 objects (LFS files + backup bundle) under projects/{id}/
  if (project?.storageConnectionId) {
    try {
      const connection = await getConnection(project.storageConnectionId);
      if (connection) {
        result.deletedS3Objects = await deleteObjectsByPrefix(connection, `projects/${id}/`);
      }
    } catch {
      // S3 cleanup failure is non-fatal
    }
  }

  // 4. Delete DB row last (so project data is gone only after cleanup attempted)
  result.deletedDb = await deleteProject(id);
  return result;
}

export async function projectHistory(projectId: string, limit?: number, offset?: number) {
  const repoPath = projectRepoPath(projectId);
  const head = await resolveHead(repoPath);
  if (!head) return { head: null, commits: [] };
  const commits = await getLog(repoPath, limit ?? 50, offset ?? 0);
  return { head, commits };
}

