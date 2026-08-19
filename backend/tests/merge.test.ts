import { describe, expect, it, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { db } from "@/config/db";
import { projects } from "@/db/schema/projects";
import { pullRequests, users } from "@/db/schema/auth";
import { SESSION_COOKIE } from "@/constants/protocol";
import { initRepo } from "@/modules/projects/git";
import { projectRepoPath } from "@/modules/projects/projects";
import { createSession } from "@/modules/auth/auth";
import { pullRequestRoutes } from "@/routes/pull-requests";
import { mergePullRequest, checkMergeable } from "@/modules/pull-requests/merge";

// Integration test for PR merging (routes + worktree merge) against real bare
// repos. Each case builds main + feature/x, creates a PR via the API, merges
// it, and verifies the resulting refs/state.
const suffix = Date.now().toString(36);
const createdProjectIds: string[] = [];
const createdUserIds: string[] = [];
const tmpDirs: string[] = [];

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: "utf8" });
}

function sha(cwd: string, ref: string): string {
  return execSync(`git rev-parse ${ref}`, { cwd, encoding: "utf8" }).trim();
}

// Seeds a bare repo with main + feature/x (one commit ahead). Returns the
// head sha of feature/x.
async function seedRepo(barePath: string, conflict = false): Promise<string> {
  const workPath = path.join(tmpdir(), `sigit-prmerge-work-${suffix}-${Math.random().toString(36).slice(2)}`);
  tmpDirs.push(workPath);
  await fs.mkdir(workPath, { recursive: true });
  sh("git init -b main", workPath);
  sh('git config user.email "test@local"', workPath);
  sh('git config user.name "Test"', workPath);
  await fs.writeFile(path.join(workPath, "base.txt"), "base\n");
  sh("git add -A && git commit -m \"test: base\" -q", workPath);
  sh("git branch feature/x", workPath);
  if (conflict) {
    // feature changes base.txt, then main also changes it -> merge conflict
    sh("git checkout feature/x -q", workPath);
    await fs.writeFile(path.join(workPath, "base.txt"), "feature change\n");
    sh("git add -A && git commit -m \"test: feature edits base\" -q", workPath);
    sh("git checkout main -q", workPath);
    await fs.writeFile(path.join(workPath, "base.txt"), "main change\n");
    sh("git add -A && git commit -m \"test: main edits base\" -q", workPath);
  } else {
    sh("git checkout feature/x -q", workPath);
    await fs.writeFile(path.join(workPath, "feature.txt"), "new\n");
    sh("git add -A && git commit -m \"test: feature\" -q", workPath);
    sh("git checkout main -q", workPath);
  }
  sh(`git remote add sigit ${barePath}`, workPath);
  sh("git push sigit main feature/x -q", workPath);
  return sha(workPath, "feature/x");
}

async function createProjectRow(name: string): Promise<string> {
  const [row] = await db
    .insert(projects)
    .values({ name, encryptionKeyEncrypted: "pr-merge-test-key" })
    .returning({ id: projects.id });
  createdProjectIds.push(row.id);
  return row.id;
}

async function createAdmin(email: string): Promise<string> {
  const [row] = await db.insert(users).values({ email, passwordHash: "pr-merge-test-hash", role: "admin" }).returning({ id: users.id });
  createdUserIds.push(row.id);
  return row.id;
}

function jsonHeaders(token: string): Headers {
  const h = new Headers({ Cookie: `${SESSION_COOKIE}=${token}` });
  h.set("Content-Type", "application/json");
  return h;
}

async function createPr(barePath: string, projectId: string, token: string): Promise<void> {
  await pullRequestRoutes.request(`/${projectId}/pull-requests`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ title: "Merge me", baseBranch: "main", headBranch: "feature/x" }),
  });
  void barePath;
}

afterAll(async () => {
  try {
    for (const id of createdProjectIds) {
      await db.delete(pullRequests).where(eq(pullRequests.projectId, id)).catch(() => {});
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
    // best effort cleanup
  }
});

describe("mergePullRequest (unit)", () => {
  it("returns a conflict result when branches touch the same file", async () => {
    const projectId = await createProjectRow(`merge-unit-${suffix}`);
    const barePath = projectRepoPath(projectId);
    await initRepo(barePath);
    await seedRepo(barePath, true);

    const res = await mergePullRequest(barePath, "main", "feature/x", "merge");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.conflict).toBe(true);
    }
  });

  it("fast-forwards cleanly when head is ahead of base", async () => {
    const projectId = await createProjectRow(`merge-unit-ff-${suffix}`);
    const barePath = projectRepoPath(projectId);
    await initRepo(barePath);
    const headSha = await seedRepo(barePath);

    const res = await mergePullRequest(barePath, "main", "feature/x", "fast_forward");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.mergeCommitSha).toBe(headSha);
    }
  });
});

describe("checkMergeable (unit)", () => {
  it("reports mergeable for clean branches", async () => {
    const projectId = await createProjectRow(`mergeable-ok-${suffix}`);
    const barePath = projectRepoPath(projectId);
    await initRepo(barePath);
    await seedRepo(barePath);

    expect(await checkMergeable(barePath, "main", "feature/x")).toBe("mergeable");
  });

  it("reports conflict when branches touch the same file", async () => {
    const projectId = await createProjectRow(`mergeable-conflict-${suffix}`);
    const barePath = projectRepoPath(projectId);
    await initRepo(barePath);
    await seedRepo(barePath, true);

    expect(await checkMergeable(barePath, "main", "feature/x")).toBe("conflict");
  });

  it("leaves the repo untouched: no worktree entries and refs unchanged", async () => {
    const projectId = await createProjectRow(`mergeable-pure-${suffix}`);
    const barePath = projectRepoPath(projectId);
    await initRepo(barePath);
    const headSha = await seedRepo(barePath);
    const mainSha = sha(barePath, "main");

    await checkMergeable(barePath, "main", "feature/x");
    const worktrees = execSync("git worktree list --porcelain", { cwd: barePath, encoding: "utf8" });
    expect(worktrees.match(/^worktree /gm)?.length ?? 0).toBe(1); // only the bare main worktree
    expect(sha(barePath, "main")).toBe(mainSha);
    expect(sha(barePath, "feature/x")).toBe(headSha);
  });

  it("returns unknown when a branch is missing", async () => {
    const projectId = await createProjectRow(`mergeable-missing-${suffix}`);
    const barePath = projectRepoPath(projectId);
    await initRepo(barePath);
    await seedRepo(barePath);

    expect(await checkMergeable(barePath, "main", "ghost")).toBe("unknown");
  });
});

describe("pull request merge", () => {
  it("merges with a merge commit and marks the PR merged", async () => {
    const projectId = await createProjectRow(`prmerge-${suffix}`);
    const barePath = projectRepoPath(projectId);
    await initRepo(barePath);
    const headSha = await seedRepo(barePath);
    const adminId = await createAdmin(`prmerge-admin-${suffix}@sigit.test`);
    const { token } = await createSession(adminId);
    await createPr(barePath, projectId, token);

    const res = await pullRequestRoutes.request(`/${projectId}/pull-requests/1/merge`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ method: "merge" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string; mergeMethod: string; mergeCommitSha: string; mergedAt: string | null } };
    expect(body.data.status).toBe("merged");
    expect(body.data.mergeMethod).toBe("merge");
    expect(body.data.mergeCommitSha).not.toBeNull();
    expect(body.data.mergedAt).not.toBeNull();

    // The bare repo main now contains the feature commit (via merge)
    const mainSha = sha(barePath, "main");
    const parents = execSync(`git cat-file -p ${mainSha}`, { cwd: barePath, encoding: "utf8" });
    expect(parents.match(/^parent /gm)?.length).toBeGreaterThanOrEqual(2); // merge commit
    expect(mainSha).not.toBe(headSha);
  });

  it("squashes into a single commit", async () => {
    const projectId = await createProjectRow(`prmerge-sq-${suffix}`);
    const barePath = projectRepoPath(projectId);
    await initRepo(barePath);
    await seedRepo(barePath);
    const adminId = await createAdmin(`prmerge-sq-admin-${suffix}@sigit.test`);
    const { token } = await createSession(adminId);
    await createPr(barePath, projectId, token);

    const res = await pullRequestRoutes.request(`/${projectId}/pull-requests/1/merge`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ method: "squash" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string; mergeMethod: string } };
    expect(body.data.status).toBe("merged");
    expect(body.data.mergeMethod).toBe("squash");
  });

  it("fast-forwards when the base is behind the head", async () => {
    const projectId = await createProjectRow(`prmerge-ff-${suffix}`);
    const barePath = projectRepoPath(projectId);
    await initRepo(barePath);
    const headSha = await seedRepo(barePath);
    const adminId = await createAdmin(`prmerge-ff-admin-${suffix}@sigit.test`);
    const { token } = await createSession(adminId);
    await createPr(barePath, projectId, token);

    const res = await pullRequestRoutes.request(`/${projectId}/pull-requests/1/merge`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ method: "fast_forward" }),
    });
    expect(res.status).toBe(200);
    expect(sha(barePath, "main")).toBe(headSha);
  });

  it("rejects merging a conflicting PR with 409", async () => {
    const projectId = await createProjectRow(`prmerge-conf-${suffix}`);
    const barePath = projectRepoPath(projectId);
    await initRepo(barePath);
    await seedRepo(barePath, true);
    const adminId = await createAdmin(`prmerge-conf-admin-${suffix}@sigit.test`);
    const { token } = await createSession(adminId);
    await createPr(barePath, projectId, token);

    const res = await pullRequestRoutes.request(`/${projectId}/pull-requests/1/merge`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ method: "merge" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("rejects merging twice or without push permission", async () => {
    const projectId = await createProjectRow(`prmerge-2x-${suffix}`);
    const barePath = projectRepoPath(projectId);
    await initRepo(barePath);
    await seedRepo(barePath);
    const adminId = await createAdmin(`prmerge-2x-admin-${suffix}@sigit.test`);
    const { token } = await createSession(adminId);
    await createPr(barePath, projectId, token);

    const first = await pullRequestRoutes.request(`/${projectId}/pull-requests/1/merge`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ method: "fast_forward" }),
    });
    expect(first.status).toBe(200);

    const second = await pullRequestRoutes.request(`/${projectId}/pull-requests/1/merge`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ method: "merge" }),
    });
    expect(second.status).toBe(400);

    // Collaborator without push -> 403
    const [collab] = await db
      .insert(users)
      .values({ email: `prmerge-noperm-${suffix}@sigit.test`, passwordHash: "pr-merge-test-hash", role: "collaborator" })
      .returning({ id: users.id });
    createdUserIds.push(collab.id);
    const { token: collabToken } = await createSession(collab.id);
    const denied = await pullRequestRoutes.request(`/${projectId}/pull-requests/1/merge`, {
      method: "POST",
      headers: jsonHeaders(collabToken),
      body: JSON.stringify({ method: "merge" }),
    });
    expect(denied.status).toBe(403);
  });
});
