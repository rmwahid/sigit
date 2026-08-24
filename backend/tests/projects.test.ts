import { describe, expect, it, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execSync } from "node:child_process";
import { createConnectionFromInput, deleteConnection, getConnection } from "@/modules/storage/connections";
import { listAllObjects, putObject } from "@/modules/storage/objects";
import {
  assertStorageDisconnectAllowed,
  countStoredLfsObjects,
  createProject,
  createProjectWithConnection,
  getProject,
  hardDeleteProject,
  projectHistory,
  projectNameFromRouteParam,
  projectRepoPath,
  updateProject,
} from "@/modules/projects/projects";
import { HttpError } from "@/lib/http-error";

// Integration test: runs against dev DB `sigit` + local MinIO (bucket sigit-test).
// Push flow uses the real git CLI against the server bare repo (replaces the removed web push).
// Storage connection is user input (SiGit architecture): credentials are sent
// inline like a user typing in the form, not from env.
const TEST_TIMEOUT = 60000;

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
  };
}

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: "utf8" });
}

async function gitPushToBare(repoPath: string, files: Record<string, string | Buffer>): Promise<void> {
  const workPath = path.join(tmpdir(), `sigit-push-work-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(workPath, { recursive: true });
  try {
    sh("git init -b main", workPath);
    sh('git config user.email "test@local"', workPath);
    sh('git config user.name "Test"', workPath);
    for (const [name, content] of Object.entries(files)) {
      const full = path.join(workPath, name);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content);
    }
    sh("git add -A && git commit -m \"test: push via git\" -q", workPath);
    sh(`git remote add sigit ${repoPath}`, workPath);
    sh("git push sigit main -q", workPath);
  } finally {
    await fs.rm(workPath, { recursive: true, force: true });
  }
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

describe("projectNameFromRouteParam", () => {
  it("strips the .git suffix from git route params", () => {
    expect(projectNameFromRouteParam("demo-project.git")).toBe("demo-project");
    expect(projectNameFromRouteParam("my.repo.git")).toBe("my.repo");
  });

  it("returns the param as-is when no .git suffix", () => {
    expect(projectNameFromRouteParam("demo-project")).toBe("demo-project");
  });

  it("handles undefined param", () => {
    expect(projectNameFromRouteParam(undefined)).toBe("");
  });
});

describe("projects integration (DB sigit + MinIO + git push)", () => {
  it("creates a project with an encrypted storage connection", async () => {
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
  }, TEST_TIMEOUT);

  it("receives a git push and exposes history", async () => {
    const { project } = await createProjectWithConnection({
      name: `test-push-${suffix}`,
      connection: storageConnection(`test-conn-push-${suffix}`),
    });
    createdProjectIds.push(project.id);
    createdConnectionIds.push(project.storageConnectionId!);

    await gitPushToBare(projectRepoPath(project.id), {
      "README.md": "# Push Test\n",
      "src/index.ts": "export const x = 1;\n",
    });

    const history = await projectHistory(project.id, 10);
    expect(history.commits.length).toBe(1);
    expect(history.commits[0].message).toBe("test: push via git");
  }, TEST_TIMEOUT);

  it("hard deletes a project (db row, repo folder)", async () => {
    const { project } = await createProjectWithConnection({
      name: `test-delete-${suffix}`,
      connection: storageConnection(`test-conn-delete-${suffix}`),
    });
    createdProjectIds.push(project.id);
    createdConnectionIds.push(project.storageConnectionId!);

    await gitPushToBare(projectRepoPath(project.id), { "file.txt": "content" });
    const repoPath = projectRepoPath(project.id);

    const res = await hardDeleteProject(project.id);
    expect(res.deletedDb).toBe(true);
    expect(res.deletedRepo).toBe(true);

    expect(await getProject(project.id)).toBeUndefined();
    let repoGone = false;
    try {
      await fs.stat(repoPath);
    } catch {
      repoGone = true;
    }
    expect(repoGone).toBe(true);
  }, TEST_TIMEOUT);

  it("creates a project with an existing connection and unique name enforcement", async () => {
    const conn = await createConnectionFromInput({
      name: `test-conn-direct-${suffix}`,
      endpoint: STORAGE.endpoint,
      region: STORAGE.region,
      accessKeyId: STORAGE.accessKeyId,
      secretAccessKey: STORAGE.secretAccessKey,
      bucket: STORAGE.bucket,
      forcePathStyle: true,
    });
    createdConnectionIds.push(conn.id);

    const project = await createProject({
      name: `test-direct-${suffix}`,
      storageConnectionId: conn.id,
    });
    createdProjectIds.push(project.id);

    // Unique name: creating a second project with the same name must be rejected
    let duplicateRejected = false;
    try {
      await createProject({ name: project.name, storageConnectionId: conn.id });
    } catch {
      duplicateRejected = true;
    }
    expect(duplicateRejected).toBe(true);

    // Objects in storage: no LFS objects for a repo without a large push
    const objects = await listAllObjects(conn, `projects/${project.id}/`);
    expect(objects).toHaveLength(0);
  }, TEST_TIMEOUT);

  it("guards storage disconnect when the project has LFS objects", async () => {
    const { project } = await createProjectWithConnection({
      name: `test-disconnect-guard-${suffix}`,
      connection: storageConnection(`test-conn-disconnect-${suffix}`),
    });
    createdProjectIds.push(project.id);
    createdConnectionIds.push(project.storageConnectionId!);
    const conn = await getConnection(project.storageConnectionId!);
    expect(conn).toBeDefined();

    // Seed an LFS object + backup bundle in the user storage.
    await putObject(conn!, `projects/${project.id}/lfs/${"a".repeat(64)}`, Buffer.from("lfs-content"));
    await putObject(conn!, `projects/${project.id}/backup.bundle`, Buffer.from("bundle"));

    const count = await countStoredLfsObjects(project, conn!);
    expect(count).toBe(1);

    // Without confirmation the disconnect is rejected (409 + dedicated code).
    let rejected = false;
    try {
      await assertStorageDisconnectAllowed(project, conn, false);
    } catch (err) {
      rejected = true;
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(409);
      expect((err as HttpError).code).toBe("DISCONNECT_CONFIRMATION_REQUIRED");
    }
    expect(rejected).toBe(true);

    // With confirmation the guard passes and the update can proceed.
    await expectNoThrow(() => assertStorageDisconnectAllowed(project, conn, true));
    await updateProject(project.id, { storageConnectionId: null, confirmStorageDisconnect: true });
    const updated = await getProject(project.id);
    expect(updated?.storageConnectionId).toBeNull();
  }, TEST_TIMEOUT);

  it("allows storage disconnect without confirmation when there are no LFS objects", async () => {
    const { project } = await createProjectWithConnection({
      name: `test-disconnect-empty-${suffix}`,
      connection: storageConnection(`test-conn-disconnect-empty-${suffix}`),
    });
    createdProjectIds.push(project.id);
    createdConnectionIds.push(project.storageConnectionId!);
    const conn = await getConnection(project.storageConnectionId!);
    expect(conn).toBeDefined();

    // No LFS objects: the guard passes without confirm.
    await expectNoThrow(() => assertStorageDisconnectAllowed(project, conn, false));
    await updateProject(project.id, { storageConnectionId: null });
    const updated = await getProject(project.id);
    expect(updated?.storageConnectionId).toBeNull();
  }, TEST_TIMEOUT);
});

async function expectNoThrow(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeUndefined();
  }
}
