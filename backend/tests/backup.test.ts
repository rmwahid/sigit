import { describe, expect, it, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { db } from "@/config/db";
import { projects } from "@/db/schema/projects";
import { storageConnections } from "@/db/schema/storage";
import { encryptSecret } from "@/lib/secret-encryption";
import { deleteRowById } from "@/lib/db";
import { initRepo } from "@/modules/projects/git";
import { projectRepoPath } from "@/modules/projects/projects";
import { backupProject, createBundle, restoreProject } from "@/modules/projects/backup";

// Integration test for backup/restore (git bundle + encrypted storage) against
// dev DB `sigit` + local MinIO (bucket sigit-test). Rows carry a unique suffix
// and are removed in afterAll.
const TEST_TIMEOUT = 60000;
const suffix = Date.now().toString(36);
const createdProjectIds: string[] = [];
const createdConnectionIds: string[] = [];
const tmpDirs: string[] = [];

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: "utf8" });
}

// Same shape as modules/projects/projects.ts#newProjectKey: a random 32-byte
// key wrapped with ENCRYPTION_KEYS (at-rest reads it back via decryptSecret).
function projectKey(): { encryptionKeyEncrypted: string; encryptionKeyId: string } {
  const wrapped = encryptSecret(crypto.randomBytes(32).toString("hex"));
  return { encryptionKeyEncrypted: wrapped.ciphertext, encryptionKeyId: wrapped.keyId };
}

async function seedRepo(barePath: string, file: string, content: string): Promise<void> {
  const work = path.join(tmpdir(), `sigit-backup-work-${suffix}-${Math.random().toString(36).slice(2)}`);
  tmpDirs.push(work);
  await fs.mkdir(work, { recursive: true });
  sh("git init -b main", work);
  sh('git config user.email "test@local"', work);
  sh('git config user.name "Test"', work);
  await fs.writeFile(path.join(work, file), content);
  sh("git add -A && git commit -m \"test: backup fixture\" -q", work);
  sh(`git remote add sigit ${barePath}`, work);
  sh("git push sigit main -q", work);
}

async function createProjectRow(name: string, withConnection = true) {
  let connectionId: string | null = null;
  if (withConnection) {
    const wrapped = encryptSecret("minioadmin");
    const [conn] = await db
      .insert(storageConnections)
      .values({
        name: `backup-conn-${suffix}`,
        endpoint: "http://127.0.0.1:9000",
        region: "us-east-1",
        accessKeyId: "minioadmin",
        secretEncrypted: wrapped.ciphertext,
        encryptionKeyId: wrapped.keyId,
        bucket: "sigit-test",
        forcePathStyle: true,
      })
      .returning({ id: storageConnections.id });
    createdConnectionIds.push(conn.id);
    connectionId = conn.id;
  }
  const [row] = await db
    .insert(projects)
    .values({
      name,
      storageConnectionId: connectionId,
      ...projectKey(),
    })
    .returning({ id: projects.id });
  createdProjectIds.push(row.id);
  return (await db.query.projects.findFirst({ where: (t, { eq }) => eq(t.id, row.id) }))!;
}

afterAll(async () => {
  for (const id of createdProjectIds) {
    await deleteRowById(projects, id);
    await fs.rm(projectRepoPath(id), { recursive: true, force: true }).catch(() => {});
  }
  for (const id of createdConnectionIds) {
    await deleteRowById(storageConnections, id).catch(() => {});
  }
  for (const dir of tmpDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

describe("backup / restore", () => {
  it(
    "creates a bundle from a bare repo and restores it into a fresh repo",
    async () => {
      const project = await createProjectRow(`backup-${suffix}`, false);
      await initRepo(projectRepoPath(project.id));
      await seedRepo(projectRepoPath(project.id), "notes.txt", "hello backup");

      const bundle = await createBundle(project);
      expect(bundle.length).toBeGreaterThan(0);

      const bundleFile = path.join(tmpdir(), `sigit-bundle-${suffix}-${Date.now()}.bundle`);
      tmpDirs.push(bundleFile);
      await fs.writeFile(bundleFile, bundle);
      const restoredPath = path.join(tmpdir(), `sigit-backup-restore-${suffix}-${Date.now()}`);
      tmpDirs.push(restoredPath);
      sh(`git clone "${bundleFile}" "${restoredPath}"`, tmpdir());
      const content = await fs.readFile(path.join(restoredPath, "notes.txt"), "utf8");
      expect(content).toBe("hello backup");
    },
    TEST_TIMEOUT
  );

  it(
    "backupProject uploads an encrypted bundle to user storage",
    async () => {
      const project = await createProjectRow(`backup-enc-${suffix}`);
      await initRepo(projectRepoPath(project.id));
      await seedRepo(projectRepoPath(project.id), "file.txt", "encrypted content");

      const { key, size } = await backupProject(project);
      expect(key).toBe(`projects/${project.id}/backup.bundle`);
      expect(size).toBeGreaterThan(0);
    },
    TEST_TIMEOUT
  );

  it(
    "restoreProject rebuilds the repo from the stored bundle",
    async () => {
      const project = await createProjectRow(`backup-restore-${suffix}`);
      await initRepo(projectRepoPath(project.id));
      await seedRepo(projectRepoPath(project.id), "notes.txt", "restore me");

      await backupProject(project);
      const stored = (await db.query.storageConnections.findFirst({ where: (t, { eq }) => eq(t.id, project.storageConnectionId!) }))!;

      // Wipe the repo, then restore from storage.
      await fs.rm(projectRepoPath(project.id), { recursive: true, force: true });
      await restoreProject(project, stored);
      const content = await fs.readFile(path.join(projectRepoPath(project.id), "notes.txt"), "utf8");
      expect(content).toBe("restore me");
    },
    TEST_TIMEOUT
  );
});
