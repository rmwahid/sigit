import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../../config/db";
import { projects, type NewProject, type Project } from "../../db/schema/projects";
import { getConnection, updateConnection } from "../storage/connections";
import { putObject } from "../storage/objects";
import { encrypt, generateSalt } from "../../lib/encryption";
import {
  commitFiles,
  createLfsPointer,
  getLog,
  initRepo,
  resolveHead,
  sha256,
  shouldUseLfs,
} from "./git";

export function projectRepoPath(project: Pick<Project, "repoPath">): string {
  if (!project.repoPath) throw new Error("Project repoPath is required");
  return path.resolve(project.repoPath);
}

export async function listProjects(): Promise<Project[]> {
  return db.select().from(projects);
}

export async function getProject(id: string): Promise<Project | undefined> {
  const rows = await db.select().from(projects).where(eq(projects.id, id));
  return rows[0];
}

export async function createProject(data: NewProject): Promise<Project> {
  if (!data.repoPath?.trim()) throw new Error("Project repoPath is required");
  const insertData: NewProject = { ...data, repoPath: path.resolve(data.repoPath) };
  const inserted = await db.insert(projects).values(insertData).returning();
  const project = inserted[0];
  if (!project) throw new Error("Failed to create project");
  await initRepo(projectRepoPath(project));
  return project;
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

  const repoPath = projectRepoPath(project);
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
  const project = await getProject(projectId);
  if (!project) return { head: null, commits: [] };
  const repoPath = projectRepoPath(project);
  const head = await resolveHead(repoPath);
  if (!head) return { head: null, commits: [] };
  const commits = await getLog(repoPath, limit ?? 50);
  return { head, commits };
}

