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
    // Rules and collaborator rows first: neither is guaranteed to cascade
    // from the project delete, and this database is shared with dev.
    await db.delete(branchProtectionRules).where(eq(branchProtectionRules.projectId, pid));
    await db.delete(projectCollaborators).where(eq(projectCollaborators.projectId, pid));
    await db.delete(projects).where(eq(projects.id, pid));
    await fs.rm(projectRepoPath(pid), { recursive: true, force: true });
    await fs.rm(protectionSnapshotPath(projectRepoPath(pid)), { force: true });
  }
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

    // A partial PATCH must change only what it names. The update schema once
    // derived from the create schema, whose defaults were then materialised for
    // the omitted keys, so this one-key body rewrote the whole rule.
    const patched = await request(branchProtectionRoutes, req("PATCH", `${base}/${rule.id}`, cookie, { requiredApprovals: 2 }));
    expect(patched.status).toBe(200);
    const patchedRule = (await patched.json()).data;
    expect(patchedRule.requiredApprovals).toBe(2);
    expect(patchedRule.requirePr).toBe(true);
    expect(patchedRule.blockDeletion).toBe(true);
    expect(patchedRule.blockForcePush).toBe(true);
    expect(patchedRule.allowAdminBypass).toBe(false);

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

  it("refuses rule mutation from a push-capable collaborator", async () => {
    const { project, cookie } = await setupProject(`bp-roles-${suffix}@sigit.test`);
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
    const ruleId = ((await created.json()) as { data: { id: string } }).data.id;

    // The collaborator holds push, the permission the rule fields constrain
    // (requirePr blocks their pushes, restrictPushUserIds names who may push),
    // plus view so the policy stays readable to them.
    const collabRows = await db
      .insert(users)
      .values({ email: `bp-roles-collab-${suffix}@sigit.test`, passwordHash: "x", role: "collaborator" })
      .returning();
    const collab = collabRows[0];
    createdUserIds.push(collab.id);
    await db.insert(projectCollaborators).values({ projectId: project.id, userId: collab.id, permissions: ["view", "push"] });
    const session = await createSession(collab.id);
    const collabCookie = `${SESSION_COOKIE}=${session.token}`;

    // Reading the policy is allowed: a restricted principal may know its rules.
    const read = await request(branchProtectionRoutes, req("GET", base, collabCookie));
    expect(read.status).toBe(200);
    const readRules = ((await read.json()) as { data: Record<string, unknown>[] }).data;
    expect(readRules).toHaveLength(1);
    // But the account allow-lists are governance data: they name who may push or
    // merge into a protected branch, and this caller can resolve an id to an
    // address through the PR list, so they are not part of the response.
    expect(readRules[0].restrictPushUserIds).toBeUndefined();
    expect(readRules[0].restrictMergeUserIds).toBeUndefined();
    expect(readRules[0].allowAdminBypass).toBeUndefined();
    expect(readRules[0].requirePr).toBe(true);

    // Lifting the restriction is not.
    const created2 = await request(branchProtectionRoutes, req("POST", base, collabCookie, { ...body, branchPattern: "release/*" }));
    expect(created2.status).toBe(403);
    const patched = await request(branchProtectionRoutes, req("PATCH", `${base}/${ruleId}`, collabCookie, { requirePr: false }));
    expect(patched.status).toBe(403);
    const deleted = await request(branchProtectionRoutes, req("DELETE", `${base}/${ruleId}`, collabCookie));
    expect(deleted.status).toBe(403);

    // The rule survived all three attempts, and the admin still sees the
    // governance fields the collaborator response omits.
    const after = await request(branchProtectionRoutes, req("GET", base, cookie));
    const rules = ((await after.json()) as { data: Record<string, unknown>[] }).data;
    expect(rules).toHaveLength(1);
    expect(rules[0].requirePr).toBe(true);
    expect(rules[0].blockDeletion).toBe(true);
    expect(rules[0].allowAdminBypass).toBe(false);
    expect(rules[0].restrictPushUserIds).toEqual([]);
    expect(rules[0].restrictMergeUserIds).toEqual([]);
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

  it("applies the LFS size gate to a non-branch ref", async () => {
    const bare = path.join(tmpdir(), `sigit-bp-tag-${suffix}`);
    rmSync(bare, { recursive: true, force: true });
    // A 1 KiB threshold, so a small file trips the gate.
    await initRepo(bare, 1024);
    const work = seedWork(bare, "tag");

    writeFileSync(path.join(work, "large.bin"), "x".repeat(4096));
    sh("git add . && git commit -m \"test: large\" -q", work);

    // Control: the same commit is refused when it arrives on a branch.
    let branchRejected = false;
    try {
      sh("git push sigit main", work);
    } catch {
      branchRejected = true;
    }
    expect(branchRejected).toBe(true);

    // The gate is not branch-specific: the same objects arriving as a tag must
    // be refused too, or a large blob reaches the server repository by tag.
    let tagRejected = false;
    try {
      sh("git push sigit HEAD:refs/tags/big", work);
    } catch {
      tagRejected = true;
    }
    expect(tagRejected).toBe(true);
    expect(sh("git -C " + bare + " tag -l", bare).trim()).toBe("");
  });
});
