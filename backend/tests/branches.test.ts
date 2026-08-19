import { describe, expect, it, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { db } from "@/config/db";
import { projects } from "@/db/schema/projects";
import { projectCollaborators, users } from "@/db/schema/auth";
import { SESSION_COOKIE } from "@/constants/protocol";
import { initRepo, listBranches, resolveBranchRef, resolveHead } from "@/modules/projects/git";
import { projectRepoPath } from "@/modules/projects/projects";
import { createSession } from "@/modules/auth/auth";
import { branchRoutes } from "@/routes/branches";

// Integration test for the web branch endpoints (create/list/delete) against
// real bare repos. Rows carry a unique suffix and are removed in afterAll.
const suffix = Date.now().toString(36);
const createdProjectIds: string[] = [];
const createdUserIds: string[] = [];
const tmpDirs: string[] = [];

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: "utf8" });
}

async function seedRepo(barePath: string): Promise<void> {
  const workPath = path.join(tmpdir(), `sigit-branches-work-${suffix}-${Math.random().toString(36).slice(2)}`);
  tmpDirs.push(workPath);
  await fs.mkdir(workPath, { recursive: true });
  sh("git init -b main", workPath);
  sh('git config user.email "test@local"', workPath);
  sh('git config user.name "Test"', workPath);
  await fs.writeFile(path.join(workPath, "hello.txt"), "hi");
  sh("git add -A && git commit -m \"test: branch fixtures\" -q", workPath);
  sh(`git remote add sigit ${barePath}`, workPath);
  sh("git push sigit main -q", workPath);
}

async function createProjectRow(name: string): Promise<string> {
  const [row] = await db
    .insert(projects)
    .values({ name, encryptionKeyEncrypted: "branches-test-key" })
    .returning({ id: projects.id });
  createdProjectIds.push(row.id);
  return row.id;
}

async function createUserRow(email: string, role = "collaborator"): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: "branches-test-hash", role })
    .returning({ id: users.id });
  createdUserIds.push(row.id);
  return row.id;
}

function cookieHeader(token: string): Headers {
  return new Headers({ Cookie: `${SESSION_COOKIE}=${token}` });
}

function jsonHeaders(token: string): Headers {
  const h = cookieHeader(token);
  h.set("Content-Type", "application/json");
  return h;
}

afterAll(async () => {
  try {
    for (const id of createdProjectIds) {
      await db.delete(projects).where(eq(projects.id, id));
      await fs.rm(projectRepoPath(id), { recursive: true, force: true }).catch(() => {});
    }
    for (const id of createdUserIds) {
      await db.delete(users).where(eq(users.id, id));
    }
    for (const dir of tmpDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  } catch {
    // best effort cleanup, rows are namespaced by suffix
  }
});

describe("branch endpoints", () => {
  it("create + list + delete a branch (push permission)", async () => {
    const projectId = await createProjectRow(`branches-${suffix}`);
    const barePath = projectRepoPath(projectId);
    await initRepo(barePath);
    await seedRepo(barePath);

    const adminEmail = `branches-admin-${suffix}@sigit.test`;
    const adminId = await createUserRow(adminEmail, "admin");
    const { token } = await createSession(adminId);
    const headers = jsonHeaders(token);

    const list = await branchRoutes.request(`/${projectId}/branches`, { headers });
    expect(list.status).toBe(200);
    const listed = ((await list.json()) as { data: { branches: string[] } }).data.branches;
    expect(listed).toContain("main");

    const headSha = await resolveHead(barePath);
    const created = await branchRoutes.request(`/${projectId}/branches`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "feature/x", fromBranch: "main" }),
    });
    expect(created.status).toBe(201);

    expect(await resolveBranchRef(barePath, "feature/x")).toBe(headSha);
    expect(await listBranches(barePath)).toContain("feature/x");

    const deleted = await branchRoutes.request(`/${projectId}/branches?branch=feature/x`, { method: "DELETE", headers });
    expect(deleted.status).toBe(200);
    expect(await resolveBranchRef(barePath, "feature/x")).toBeNull();
  });

  it("enforces push permission and validation", async () => {
    const projectId = await createProjectRow(`branches-perm-${suffix}`);
    const barePath = projectRepoPath(projectId);
    await initRepo(barePath);
    await seedRepo(barePath);

    const noPermEmail = `branches-noperm-${suffix}@sigit.test`;
    const noPermId = await createUserRow(noPermEmail);
    const { token } = await createSession(noPermId);
    const denied = await branchRoutes.request(`/${projectId}/branches`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ name: "nope" }),
    });
    expect(denied.status).toBe(403);

    const adminEmail = `branches-admin2-${suffix}@sigit.test`;
    const adminId = await createUserRow(adminEmail);
    await db.insert(projectCollaborators).values({ projectId, userId: adminId, permissions: ["push"] });
    const { token: adminToken } = await createSession(adminId);
    const adminHeaders = jsonHeaders(adminToken);

    const badName = await branchRoutes.request(`/${projectId}/branches`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: "bad name!" }),
    });
    expect(badName.status).toBe(400);

    const dotDotName = await branchRoutes.request(`/${projectId}/branches`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: "a..b" }),
    });
    expect(dotDotName.status).toBe(400);

    const dup = await branchRoutes.request(`/${projectId}/branches`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: "main" }),
    });
    expect(dup.status).toBe(400);
    expect(((await dup.json()) as { error: { code: string } }).error.code).toBe("BRANCH_EXISTS");

    const missing = await branchRoutes.request(`/${projectId}/branches`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: "ok", fromBranch: "does-not-exist" }),
    });
    expect(missing.status).toBe(400);

    const delDefault = await branchRoutes.request(`/${projectId}/branches?branch=main`, { method: "DELETE", headers: adminHeaders });
    expect(delDefault.status).toBe(400);
  });
});
