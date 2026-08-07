import path from "node:path";
import fs from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "../../config/db";
import { projects, type NewProject, type Project } from "../../db/schema/projects";
import { storageConnections } from "../../db/schema/storage";
import { getConnection, updateConnection } from "../storage/connections";
import { putObject, deleteObjectsByPrefix } from "../storage/objects";
import { encrypt, generateSalt } from "../../lib/encryption";
import { encryptSecret } from "../../lib/secret-encryption";
import {
  commitFiles,
  createLfsPointer,
  getLog,
  initRepo,
  resolveHead,
  sha256,
  shouldUseLfs,
} from "./git";

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

export async function createProject(data: NewProject): Promise<Project> {
  if (!data.storageConnectionId) {
    throw new Error("Project storage connection is required");
  }
  const inserted = await db.insert(projects).values(data).returning();
  const project = inserted[0];
  if (!project) throw new Error("Failed to create project");
  await initRepo(projectRepoPath(project.id));
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
    useEncryption?: boolean;
  };
};

export async function createProjectWithConnection(
  data: CreateProjectWithConnectionInput
): Promise<{ project: Project; connectionId: string }> {
  return db.transaction(async (tx) => {
    const conn = data.connection;
    const encrypted = encryptSecret(conn.secretAccessKey);
    const connRows = await tx
      .insert(storageConnections)
      .values({
        name: conn.name,
        endpoint: conn.endpoint,
        region: conn.region,
        accessKeyId: conn.accessKeyId,
        secretEncrypted: encrypted.ciphertext,
        encryptionKeyId: encrypted.keyId,
        bucket: conn.bucket,
        forcePathStyle: conn.forcePathStyle ?? true,
        useEncryption: conn.useEncryption ?? false,
        encryptionSalt: conn.useEncryption ? generateSalt() : null,
      })
      .returning();
    const connection = connRows[0];

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

    await initRepo(projectRepoPath(project.id));
    return { project, connectionId: connection.id };
  });
}

export async function updateProject(id: string, data: Partial<NewProject>): Promise<Project | undefined> {
  const rows = await db
    .update(projects)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning();
  return rows[0];
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

export type PushFile = {
  relativePath: string;
  content: Buffer;
  contentType?: string;
};

export async function pushProject(
  project: Project,
  files: PushFile[],
  message: string,
  passphrase?: string
): Promise<{ commitHash: string; files: { path: string; lfs: boolean; oid?: string }[] }> {
  if (!project.storageConnectionId) throw new Error("Project has no storage connection");
  const connection = await getConnection(project.storageConnectionId);
  if (!connection) throw new Error("Storage connection not found");

  const repoPath = projectRepoPath(project.id);
  await initRepo(repoPath);

  const committedFiles: { relativePath: string; content: Buffer }[] = [];
  const result: { path: string; lfs: boolean; oid?: string }[] = [];

  for (const file of files) {
    const useLfs = shouldUseLfs(project, file.content, file.relativePath);
    if (useLfs) {
      const oid = sha256(file.content);
      let objectBody = file.content;
      if (project.useEncryption) {
        if (!passphrase) throw new Error("Passphrase required for encrypted project");
        const salt = connection.encryptionSalt ?? generateSalt();
        const enc = encrypt(objectBody, passphrase, Buffer.from(salt, "base64"));
        const iv = Buffer.from(enc.iv, "base64");
        const tag = Buffer.from(enc.tag, "base64");
        objectBody = Buffer.concat([iv, tag, enc.ciphertext]);
        if (!connection.encryptionSalt) {
          connection.encryptionSalt = salt;
          await updateConnection(connection.id, { encryptionSalt: salt });
        }
      }
      const s3Key = `projects/${project.id}/lfs/${oid}`;
      await putObject(connection, s3Key, objectBody, file.contentType ?? "application/octet-stream");
      const pointer = createLfsPointer(oid, file.content.length);
      committedFiles.push({ relativePath: file.relativePath, content: Buffer.from(pointer, "utf-8") });
      result.push({ path: file.relativePath, lfs: true, oid });
    } else {
      committedFiles.push({ relativePath: file.relativePath, content: file.content });
      result.push({ path: file.relativePath, lfs: false });
    }
  }

  const { commitHash } = await commitFiles(repoPath, committedFiles, message);
  return { commitHash, files: result };
}

export async function projectHistory(projectId: string, limit?: number) {
  const repoPath = projectRepoPath(projectId);
  const head = await resolveHead(repoPath);
  if (!head) return { head: null, commits: [] };
  const commits = await getLog(repoPath, limit ?? 50);
  return { head, commits };
}

