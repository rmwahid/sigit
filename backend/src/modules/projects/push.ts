import { getConnection, updateConnection } from "../storage/connections";
import { putObject } from "../storage/objects";
import { encrypt, generateSalt } from "../../lib/encryption";
import { createLfsPointer, sha256, shouldUseLfs } from "../lfs";
import { commitFiles, initRepo } from "./git";
import { projectRepoPath } from "./projects";
import type { Project } from "../../db/schema/projects";
import type { StorageConnection } from "../../db/schema/storage";

export type PushFile = {
  relativePath: string;
  content: Buffer;
  contentType?: string;
};

async function uploadLfsObject(
  project: Project,
  connection: StorageConnection,
  file: PushFile,
  passphrase?: string
): Promise<{ oid: string; pointer: string }> {
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
  return { oid, pointer: createLfsPointer(oid, file.content.length) };
}

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
    if (shouldUseLfs(project, file.content, file.relativePath)) {
      const { oid, pointer } = await uploadLfsObject(project, connection, file, passphrase);
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
