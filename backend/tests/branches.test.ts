import { describe, expect, it, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/config/db";
import { projects } from "@/db/schema/projects";
import { branchProtectionRules, projectCollaborators, users } from "@/db/schema/auth";
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

// Same field set the route sends to createProtectionRule; overrides tune one
// rule per case.
async function addRule(projectId: string, overrides: Partial<typeof branchProtectionRules.$inferInsert> = {}) {
  await db.insert(branchProtectionRules).values({
    projectId,
    branchPattern: "*",
    requirePr: false,
    requiredApprovals: 0,
    blockOnRequestChanges: false,
    blockForcePush: true,
    blockDeletion: true,
    restrictPushUserIds: null,
    restrictMergeUserIds: null,
    allowAdminBypass: false,
    ...overrides,
  });
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
      // Rules and collaborator rows first: neither is guaranteed to cascade
      // from the project delete, and this database is shared with dev.
      await db.delete(branchProtectionRules).where(eq(branchProtectionRules.projectId, id));
      await db.delete(projectCollaborators).where(eq(projectCollaborators.projectId, id));
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

  it("applies branch protection rules to ref updates made through the API", async () => {
    const projectId = await createProjectRow(`branches-prot-${suffix}`);
    const barePath = projectRepoPath(projectId);
    await initRepo(barePath);
    await seedRepo(barePath);

    const pusherId = await createUserRow(`branches-prot-${suffix}@sigit.test`);
    await db.insert(projectCollaborators).values({ projectId, userId: pusherId, permissions: ["push"] });
    const { token } = await createSession(pusherId);
    const headers = jsonHeaders(token);

    // Branches are created while no rule covers them, then protected, because
    // the point here is the API path: these handlers call git update-ref, which
    // never runs the pre-receive hook the rules rely on.
    const created = await branchRoutes.request(`/${projectId}/branches`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "feature/keep", fromBranch: "main" }),
    });
    expect(created.status).toBe(201);

    await addRule(projectId, { branchPattern: "feature/*", blockDeletion: true });
    const blockedDelete = await branchRoutes.request(`/${projectId}/branches?branch=feature/keep`, { method: "DELETE", headers });
    expect(blockedDelete.status).toBe(403);
    expect(await resolveBranchRef(barePath, "feature/keep")).not.toBeNull();

    // A branch no rule covers is still deletable, so the gate is the rule and
    // not the guard itself.
    await branchRoutes.request(`/${projectId}/branches`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "temp/scratch", fromBranch: "main" }),
    });
    const allowedDelete = await branchRoutes.request(`/${projectId}/branches?branch=temp/scratch`, { method: "DELETE", headers });
    expect(allowedDelete.status).toBe(200);

    // Creating a branch under a rule that requires pull requests is the same
    // write the hook refuses on a push.
    await addRule(projectId, { branchPattern: "release/*", requirePr: true });
    const blockedCreate = await branchRoutes.request(`/${projectId}/branches`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "release/1.0", fromBranch: "main" }),
    });
    expect(blockedCreate.status).toBe(403);
    expect(await resolveBranchRef(barePath, "release/1.0")).toBeNull();

    // The push whitelist is read from the same user id the hook gets from
    // GITPUSH_USER_ID: listed users pass, everyone else is refused.
    await addRule(projectId, { branchPattern: "wip/*", restrictPushUserIds: [pusherId] });
    const whitelisted = await branchRoutes.request(`/${projectId}/branches`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "wip/mine", fromBranch: "main" }),
    });
    expect(whitelisted.status).toBe(201);

    await addRule(projectId, { branchPattern: "other/*", restrictPushUserIds: [randomUUID()] });
    const notListed = await branchRoutes.request(`/${projectId}/branches`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "other/theirs", fromBranch: "main" }),
    });
    expect(notListed.status).toBe(403);
  });
});
