// Paired test for modules/projects/branch-protection.ts: pure pattern
// matching + snapshot serialization + merge-gate logic (protection.ts).
import { describe, expect, it } from "bun:test";
import { findProtectionRule, patternMatches, rulesSnapshot } from "@/modules/projects/branch-protection";
import type { BranchProtectionRule } from "@/db/schema/auth";

const rule = (branchPattern: string, extra: Partial<BranchProtectionRule> = {}): BranchProtectionRule => ({
  id: "id",
  projectId: "pid",
  branchPattern,
  requirePr: false,
  requiredApprovals: 0,
  blockOnRequestChanges: false,
  blockForcePush: true,
  blockDeletion: true,
  restrictPushUserIds: null,
  restrictMergeUserIds: null,
  allowAdminBypass: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...extra,
});

describe("patternMatches", () => {
  it("matches exact branch names", () => {
    expect(patternMatches("main", "main")).toBe(true);
    expect(patternMatches("main", "main2")).toBe(false);
    expect(patternMatches("release/v1", "release/v1")).toBe(true);
  });

  it("matches the * catch-all", () => {
    expect(patternMatches("*", "main")).toBe(true);
    expect(patternMatches("*", "anything/at/all")).toBe(true);
  });

  it("matches prefix wildcards at the end only", () => {
    expect(patternMatches("feature/*", "feature/x")).toBe(true);
    expect(patternMatches("feature/*", "feature/x/y")).toBe(true);
    expect(patternMatches("feature/*", "feature")).toBe(false);
    expect(patternMatches("feature/*", "features/x")).toBe(false);
    // wildcard in the middle is not supported
    expect(patternMatches("a*b", "axb")).toBe(false);
  });
});

describe("findProtectionRule", () => {
  it("returns undefined when no rule covers the branch", () => {
    expect(findProtectionRule([], "main")).toBeUndefined();
    expect(findProtectionRule([rule("feature/*")], "main")).toBeUndefined();
  });

  it("exact match beats a prefix wildcard", () => {
    const rules = [rule("feature/*"), rule("feature/main")];
    expect(findProtectionRule(rules, "feature/main")?.branchPattern).toBe("feature/main");
  });

  it("longer prefix beats a shorter one", () => {
    const rules = [rule("feature/*"), rule("feature/release/*")];
    expect(findProtectionRule(rules, "feature/release/x")?.branchPattern).toBe("feature/release/*");
  });

  it("* is the fallback with the lowest priority", () => {
    const rules = [rule("*"), rule("feature/*")];
    expect(findProtectionRule(rules, "feature/x")?.branchPattern).toBe("feature/*");
    expect(findProtectionRule(rules, "main")?.branchPattern).toBe("*");
  });
});

describe("rulesSnapshot", () => {
  it("serializes rules as shell-parseable key=value blocks", () => {
    const snapshot = rulesSnapshot([
      rule("main", { requirePr: true, requiredApprovals: 2, restrictPushUserIds: ["u1", "u2"] }),
      rule("feature/*"),
    ]);
    expect(snapshot).toContain("pattern=main");
    expect(snapshot).toContain("requirePr=true");
    expect(snapshot).toContain("requiredApprovals=2");
    expect(snapshot).toContain("restrictPushUserIds=u1,u2");
    expect(snapshot).toContain("pattern=feature/*");
    // blocks are blank-line separated (the hook splits on them)
    expect(snapshot.split("\n\n").length).toBe(2);
  });

  it("serializes null whitelists as empty strings", () => {
    const snapshot = rulesSnapshot([rule("main")]);
    expect(snapshot).toContain("restrictPushUserIds=");
    expect(snapshot).toContain("restrictMergeUserIds=");
  });
});

// --- route + hook integration (same base name: branch-protection) ---
const suffix = Date.now().toString(36);
const createdProjectIds: string[] = [];
const createdUserIds: string[] = [];

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: "utf8" });
}


import { afterAll } from "bun:test";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { db } from "@/config/db";
import { projects } from "@/db/schema/projects";
import { branchProtectionRules, projectCollaborators, users } from "@/db/schema/auth";
import { SESSION_COOKIE } from "@/constants/protocol";
import { initRepo } from "@/modules/projects/git";
import { projectRepoPath } from "@/modules/projects/projects";
import { createSession } from "@/modules/auth/auth";
import { writeProtectionSnapshot, protectionSnapshotPath } from "@/modules/projects/protection-snapshot";
import { branchProtectionRoutes } from "@/routes/branch-protection";

async function setupProject(adminEmail: string) {
  const adminRows = await db
    .insert(users)
    .values({ email: adminEmail, passwordHash: "x", role: "admin" })
    .onConflictDoNothing()
    .returning();
  const admin = adminRows[0] ?? (await db.select().from(users).where(eq(users.email, adminEmail)))[0];
  createdUserIds.push(admin.id);
  const session = await createSession(admin.id);
  const cookie = `${SESSION_COOKIE}=${session.token}`;
  const name = `bp-${suffix}-${Math.random().toString(36).slice(2)}`;
  const row = await db
    .insert(projects)
    .values({ name, description: null, lfsSizeThreshold: 5 * 1024 * 1024, encryptionKeyEncrypted: "bp-test-key" })
    .returning();
  const project = row[0];
  createdProjectIds.push(project.id);
  await initRepo(projectRepoPath(project.id));
  return { project, cookie };
}

function request(app: typeof branchProtectionRoutes, req: Request): Promise<Response> {
  return app.request(req);
}

function req(method: string, url: string, cookie: string, body?: unknown): Request {
  return new Request(`http://x${url}`, {
    method,
    headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

afterAll(async () => {
  for (const pid of createdProjectIds) {
    await fs.rm(projectRepoPath(pid), { recursive: true, force: true });
    await fs.rm(protectionSnapshotPath(projectRepoPath(pid)), { force: true });
  }
  if (createdProjectIds.length) {
    await db.delete(branchProtectionRules).where(eq(branchProtectionRules.projectId, createdProjectIds[0]));
  }
  await db.delete(projectCollaborators).where(eq(projectCollaborators.projectId, createdProjectIds[0]));
  for (const id of createdProjectIds) await db.delete(projects).where(eq(projects.id, id));
  for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
});

describe("branch protection routes", () => {
  it("creates, lists, updates and deletes a rule", async () => {
    const { project, cookie } = await setupProject(`bp-admin-${suffix}@sigit.test`);
    const base = `/${project.id}/branch-protection`;
    const body = {
      branchPattern: "main",
      requirePr: true,
      requiredApprovals: 1,
      blockOnRequestChanges: false,
      blockForcePush: true,
      blockDeletion: true,
      restrictPushUserIds: [],
      restrictMergeUserIds: [],
      allowAdminBypass: false,
    };

    const created = await request(branchProtectionRoutes, req("POST", base, cookie, body));
    expect(created.status).toBe(201);
    const rule = (await created.json()).data;
    expect(rule.branchPattern).toBe("main");
    expect(rule.requirePr).toBe(true);

    const listed = await request(branchProtectionRoutes, req("GET", base, cookie));
    expect(listed.status).toBe(200);
    const rules = (await listed.json()).data;
    expect(rules).toHaveLength(1);

    const patched = await request(branchProtectionRoutes, req("PATCH", `${base}/${rule.id}`, cookie, { requiredApprovals: 2 }));
    expect(patched.status).toBe(200);
    expect((await patched.json()).data.requiredApprovals).toBe(2);

    const deleted = await request(branchProtectionRoutes, req("DELETE", `${base}/${rule.id}`, cookie));
    expect(deleted.status).toBe(200);
    const after = await request(branchProtectionRoutes, req("GET", base, cookie));
    expect((await after.json()).data).toHaveLength(0);
  });

  it("rejects duplicate patterns with 400", async () => {
    const { project, cookie } = await setupProject(`bp-dup-${suffix}@sigit.test`);
    const base = `/${project.id}/branch-protection`;
    const body = {
      branchPattern: "main",
      requirePr: false,
      requiredApprovals: 0,
      blockOnRequestChanges: false,
      blockForcePush: true,
      blockDeletion: true,
      restrictPushUserIds: [],
      restrictMergeUserIds: [],
      allowAdminBypass: false,
    };
    expect((await request(branchProtectionRoutes, req("POST", base, cookie, body))).status).toBe(201);
    const dup = await request(branchProtectionRoutes, req("POST", base, cookie, body));
    expect(dup.status).toBe(400);
  });

  it("rejects invalid patterns with 400", async () => {
    const { project, cookie } = await setupProject(`bp-bad-${suffix}@sigit.test`);
    const base = `/${project.id}/branch-protection`;
    const body = {
      branchPattern: "a..b",
      requirePr: false,
      requiredApprovals: 0,
      blockOnRequestChanges: false,
      blockForcePush: true,
      blockDeletion: true,
      restrictPushUserIds: [],
      restrictMergeUserIds: [],
      allowAdminBypass: false,
    };
    const res = await request(branchProtectionRoutes, req("POST", base, cookie, body));
    expect(res.status).toBe(400);
  });

  it("writes the hook snapshot on every mutation", async () => {
    const { project, cookie } = await setupProject(`bp-snap-${suffix}@sigit.test`);
    const base = `/${project.id}/branch-protection`;
    const body = {
      branchPattern: "release/*",
      requirePr: true,
      requiredApprovals: 0,
      blockOnRequestChanges: false,
      blockForcePush: true,
      blockDeletion: true,
      restrictPushUserIds: [],
      restrictMergeUserIds: [],
      allowAdminBypass: false,
    };
    await request(branchProtectionRoutes, req("POST", base, cookie, body));
    const snapshot = await fs.readFile(protectionSnapshotPath(projectRepoPath(project.id)), "utf8");
    expect(snapshot).toContain("pattern=release/*");
    expect(snapshot).toContain("requirePr=true");
  });
});

// --- pre-receive hook enforcement (real git push, no server) ---
describe("pre-receive hook branch protection", () => {
  function seedWork(barePath: string, label: string): string {
    const work = path.join(tmpdir(), `sigit-bp-work-${suffix}-${label}`);
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    sh("git init -b main", work);
    sh('git config user.email "t@l"', work);
    sh('git config user.name "T"', work);
    writeFileSync(path.join(work, "a.txt"), "a\n");
    sh("git add . && git commit -m \"test: base\" -q", work);
    sh(`git remote add sigit ${barePath}`, work);
    sh("git push sigit main -q", work);
    return work;
  }

  it("blocks deletion of a protected branch", async () => {
    const bare = path.join(tmpdir(), `sigit-bp-del-${suffix}`);
    rmSync(bare, { recursive: true, force: true });
    await initRepo(bare);
    const work = seedWork(bare, "del");
    // Without this, git itself refuses to delete the current branch and the
    // hook never runs; with it, only the hook can stop the deletion.
    sh('git config receive.denyDeleteCurrent ignore', bare);
    // protect main with blockDeletion
    await writeProtectionSnapshot(bare, "pattern=main\nrequirePr=false\nrequiredApprovals=0\nblockOnRequestChanges=false\nblockForcePush=false\nblockDeletion=true\nrestrictPushUserIds=\nrestrictMergeUserIds=\nallowAdminBypass=false\n\n");

    let rejected = false;
    try {
      sh("git push sigit :main", work);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it("blocks direct pushes when requirePr is set", async () => {
    const bare = path.join(tmpdir(), `sigit-bp-pr-${suffix}`);
    rmSync(bare, { recursive: true, force: true });
    await initRepo(bare);
    const work = seedWork(bare, "pr");
    await writeProtectionSnapshot(bare, "pattern=main\nrequirePr=true\nrequiredApprovals=0\nblockOnRequestChanges=false\nblockForcePush=false\nblockDeletion=false\nrestrictPushUserIds=\nrestrictMergeUserIds=\nallowAdminBypass=false\n\n");

    writeFileSync(path.join(work, "a.txt"), "a\nb\n");
    sh("git add . && git commit -m \"test: change\" -q", work);
    let rejected = false;
    try {
      sh("git push sigit main", work);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it("allows direct pushes when requirePr is off (rules exist but gate is off)", async () => {
    const bare = path.join(tmpdir(), `sigit-bp-open-${suffix}`);
    rmSync(bare, { recursive: true, force: true });
    await initRepo(bare);
    const work = seedWork(bare, "open");
    await writeProtectionSnapshot(bare, "pattern=main\nrequirePr=false\nrequiredApprovals=0\nblockOnRequestChanges=false\nblockForcePush=false\nblockDeletion=false\nrestrictPushUserIds=\nrestrictMergeUserIds=\nallowAdminBypass=false\n\n");

    writeFileSync(path.join(work, "a.txt"), "a\nc\n");
    sh("git add . && git commit -m \"test: change\" -q", work);
    sh("git push sigit main -q", work);
    expect(sh("git -C " + bare + " log --oneline -1", bare).trim()).toMatch(/change/);
  });

  it("blocks pushes from users outside the whitelist (GITPUSH_USER_ID)", async () => {
    const bare = path.join(tmpdir(), `sigit-bp-restrict-${suffix}`);
    rmSync(bare, { recursive: true, force: true });
    await initRepo(bare);
    const work = seedWork(bare, "restrict");
    await writeProtectionSnapshot(bare, "pattern=main\nrequirePr=false\nrequiredApprovals=0\nblockOnRequestChanges=false\nblockForcePush=false\nblockDeletion=false\nrestrictPushUserIds=00000000-0000-0000-0000-0000000000aa\nrestrictMergeUserIds=\nallowAdminBypass=false\n\n");

    writeFileSync(path.join(work, "a.txt"), "a\nd\n");
    sh("git add . && git commit -m \"test: change\" -q", work);
    let rejected = false;
    try {
      // simulate the server: GITPUSH_USER_ID points to a user outside the
      // whitelist (env via bash so the value actually reaches the hook)
      sh('bash -c "GITPUSH_USER_ID=00000000-0000-0000-0000-0000000000bb git push sigit main"', work);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});
