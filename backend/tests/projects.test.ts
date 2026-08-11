import { describe, expect, it, afterAll } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createConnection, deleteConnection, getConnection } from "../src/modules/storage/connections";
import { getObject, listAllObjects } from "../src/modules/storage/objects";
import { encryptSecret } from "../src/lib/secret-encryption";
import { parseLfsPointer, sha256 } from "../src/modules/lfs";
import {
  createProject,
  createProjectWithConnection,
  getProject,
  hardDeleteProject,
  projectRepoPath,
  pushProject,
  type PushFile,
} from "../src/modules/projects/projects";

// Integration test: runs against dev DB `sigit` + local MinIO (bucket sigit-test).
// Semua data dibuat dengan prefix test- dan dibersihkan otomatis di afterAll.
// Koneksi storage adalah input user (arsitektur SiGit): kredensial dikirim
// inline seperti user mengetik di form, bukan dari env.
// MinIO uploads + git operations can exceed bun's default 5s per-test timeout.
const TEST_TIMEOUT = 30000;

const STORAGE = {
  endpoint: "http://127.0.0.1:9000",
  region: "us-east-1",
  accessKeyId: "minioadmin",
  secretAccessKey: "minioadmin",
  bucket: "sigit-test",
};

const suffix = Date.now().toString(36);
const createdProjectIds: string[] = [];
const createdConnectionIds: string[] = [];

function storageConnection(name: string) {
  return {
    name,
    endpoint: STORAGE.endpoint,
    region: STORAGE.region,
    accessKeyId: STORAGE.accessKeyId,
    secretAccessKey: STORAGE.secretAccessKey,
    bucket: STORAGE.bucket,
    forcePathStyle: true,
    useEncryption: false,
  };
}

async function cleanup() {
  for (const id of createdProjectIds) {
    try {
      await hardDeleteProject(id);
    } catch {
      // best effort
    }
  }
  for (const id of createdConnectionIds) {
    try {
      await deleteConnection(id);
    } catch {
      // best effort
    }
  }
}

afterAll(async () => {
  await cleanup();
}, TEST_TIMEOUT);

describe("projects integration (DB sigit + MinIO)", () => {
  it("creates a project together with an encrypted storage connection", async () => {
    const { project, connectionId } = await createProjectWithConnection({
      name: `test-create-${suffix}`,
      connection: storageConnection(`test-conn-${suffix}`),
    });
    createdProjectIds.push(project.id);
    createdConnectionIds.push(connectionId);

    expect(project.storageConnectionId).toBe(connectionId);

    const conn = await getConnection(connectionId);
    expect(conn).toBeDefined();
    expect(conn?.secretEncrypted).toBeTruthy();
    expect(conn?.secretEncrypted).not.toContain(STORAGE.secretAccessKey);

    const repoPath = projectRepoPath(project.id);
    await expect(fs.stat(repoPath)).resolves.toBeDefined();
  }, TEST_TIMEOUT);

  it("pushes a small file into git (not LFS)", async () => {
    const { project } = await createProjectWithConnection({
      name: `test-small-${suffix}`,
      connection: storageConnection(`test-conn-small-${suffix}`),
    });
    createdProjectIds.push(project.id);
    createdConnectionIds.push(project.storageConnectionId!);

    const content = Buffer.from("# Test\n");
    const res = await pushProject(project, [{ relativePath: "readme.md", content }], "test: push small file");
    expect(res.files[0].lfs).toBe(false);

    const fileContent = await fs.readFile(path.join(projectRepoPath(project.id), "readme.md"), "utf8");
    expect(fileContent).toBe("# Test\n");

    const objects = await listAllObjects(
      (await getConnection(project.storageConnectionId!))!,
      `projects/${project.id}/`
    );
    expect(objects).toHaveLength(0);
  }, TEST_TIMEOUT);

  it("pushes a large file to MinIO as an LFS pointer", async () => {
    const { project } = await createProjectWithConnection({
      name: `test-large-${suffix}`,
      connection: storageConnection(`test-conn-large-${suffix}`),
    });
    createdProjectIds.push(project.id);
    createdConnectionIds.push(project.storageConnectionId!);

    const large = crypto.randomBytes(11 * 1024 * 1024); // > 10 MB threshold
    const oid = sha256(large);
    const res = await pushProject(project, [{ relativePath: "big.bin", content: large }], "test: push large file");
    expect(res.files[0].lfs).toBe(true);
    expect(res.files[0].oid).toBe(oid);

    // Pointer file in git repo
    const pointerContent = await fs.readFile(path.join(projectRepoPath(project.id), "big.bin"), "utf8");
    const parsed = parseLfsPointer(pointerContent);
    expect(parsed?.oid).toBe(oid);
    expect(parsed?.size).toBe(large.length);

    // Object in MinIO, content matches
    const conn = (await getConnection(project.storageConnectionId!))!;
    const obj = await getObject(conn, `projects/${project.id}/lfs/${oid}`);
    expect(obj.equals(large)).toBe(true);
  }, TEST_TIMEOUT);

  it("hard deletes a project (db row, repo folder, S3 objects)", async () => {
    const { project } = await createProjectWithConnection({
      name: `test-delete-${suffix}`,
      connection: storageConnection(`test-conn-delete-${suffix}`),
    });
    createdProjectIds.push(project.id);
    createdConnectionIds.push(project.storageConnectionId!);

    const large = crypto.randomBytes(11 * 1024 * 1024);
    await pushProject(project, [{ relativePath: "big.bin", content: large }], "test: push before delete");

    const repoPath = projectRepoPath(project.id);
    const conn = (await getConnection(project.storageConnectionId!))!;

    const res = await hardDeleteProject(project.id);
    expect(res.deletedDb).toBe(true);
    expect(res.deletedRepo).toBe(true);
    expect(res.deletedS3Objects).toBeGreaterThan(0);

    // NOTE: Jangan pakai expect(promise).resolves/.rejects untuk promise
    // drizzle/postgres — hang di bun test 1.3.13. Pakai plain await + expect.
    expect(await getProject(project.id)).toBeUndefined();
    let repoGone = false;
    try {
      await fs.stat(repoPath);
    } catch {
      repoGone = true;
    }
    expect(repoGone).toBe(true);

    const remaining = await listAllObjects(conn, `projects/${project.id}/`);
    expect(remaining).toHaveLength(0);
  }, TEST_TIMEOUT);

  it("creates a project with an existing connection and custom threshold", async () => {
    const enc = encryptSecret(STORAGE.secretAccessKey);
    const conn = await createConnection({
      name: `test-conn-direct-${suffix}`,
      endpoint: STORAGE.endpoint,
      region: STORAGE.region,
      accessKeyId: STORAGE.accessKeyId,
      secretEncrypted: enc.ciphertext,
      encryptionKeyId: enc.keyId,
      bucket: STORAGE.bucket,
      forcePathStyle: true,
      useEncryption: false,
      encryptionSalt: null,
    });
    createdConnectionIds.push(conn.id);

    const project = await createProject({
      name: `test-direct-${suffix}`,
      storageConnectionId: conn.id,
      lfsSizeThreshold: 1024, // small threshold so a 2 KB file goes to LFS
    });
    createdProjectIds.push(project.id);

    const files: PushFile[] = [{ relativePath: "asset.dat", content: crypto.randomBytes(2048) }];
    const res = await pushProject(project, files, "test: push with custom threshold");
    expect(res.files[0].lfs).toBe(true);
  }, TEST_TIMEOUT);
});
