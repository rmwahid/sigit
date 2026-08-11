import path from "node:path";
import fs from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "../../config/db";
import { projects, type NewProject, type Project } from "../../db/schema/projects";
import { createConnectionFromInput, getConnection } from "../storage/connections";
import { deleteObjectsByPrefix } from "../storage/objects";
import { getLog, initRepo, installPreReceiveHook, resolveHead } from "./git";

const PROJECTS_ROOT = process.env.SIGIT_PROJECTS_ROOT ?? "./data/projects";

export function projectRepoPath(projectId: string): string {
  return path.resolve(PROJECTS_ROOT, projectId);
}

export async function listProjects(): Promise<Project[]> {
  return db.select().from(projects);
}

export async function getProject(id: string): Promise<Project | undefined> {
  const rows = await db.select().from(projects).where(eq(projects.id, id));
  return rows[0];
}

// Nama project unik (URL git /projects/<name>.git)
export async function getProjectByName(name: string): Promise<Project | undefined> {
  const rows = await db.select().from(projects).where(eq(projects.name, name));
  return rows[0];
}

export async function createProject(data: NewProject): Promise<Project> {
  if (!data.storageConnectionId) {
    throw new Error("Project storage connection is required");
  }
  const inserted = await db.insert(projects).values(data).returning();
  const project = inserted[0];
  if (!project) throw new Error("Failed to create project");
  await initRepo(projectRepoPath(project.id), project.lfsSizeThreshold);
  return project;
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
    const connection = await createConnectionFromInput(data.connection, tx);
    const projRows = await tx
      .insert(projects)
      .values({
        name: data.name,
        description: data.description,
        storageConnectionId: connection.id,
      })
      .returning();
    const project = projRows[0];
    if (!project) throw new Error("Failed to create project");

    await initRepo(projectRepoPath(project.id), project.lfsSizeThreshold);
    return { project, connectionId: connection.id };
  });
}

export async function updateProject(id: string, data: Partial<NewProject>): Promise<Project | undefined> {
  const rows = await db
    .update(projects)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning();
  const project = rows[0];
  // Threshold berubah → regenerate pre-receive hook
  if (project && data.lfsSizeThreshold) {
    await installPreReceiveHook(projectRepoPath(project.id), project.lfsSizeThreshold);
  }
  return project;
}

export async function deleteProject(id: string): Promise<boolean> {
  const rows = await db.delete(projects).where(eq(projects.id, id)).returning();
  return rows.length > 0;
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

export async function projectHistory(projectId: string, limit?: number) {
  const repoPath = projectRepoPath(projectId);
  const head = await resolveHead(repoPath);
  if (!head) return { head: null, commits: [] };
  const commits = await getLog(repoPath, limit ?? 50);
  return { head, commits };
}

