// Paired test for the pull request feature: constants invariants + route
// integration against real bare repos with two branches. Rows carry a unique
// suffix and are removed in afterAll.
import { describe, expect, it, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { db } from "@/config/db";
import { projects } from "@/db/schema/projects";
import { projectCollaborators, pullRequests, users } from "@/db/schema/auth";
import { SESSION_COOKIE } from "@/constants/protocol";
import { initRepo } from "@/modules/projects/git";
import { projectRepoPath } from "@/modules/projects/projects";
import { createSession } from "@/modules/auth/auth";
import { pullRequestRoutes } from "@/routes/pull-requests";
import {
  PR_STATUSES,
  PR_STATUS_SLUGS,
  PR_TERMINAL_STATUSES,
  MERGE_METHODS,
  MERGE_METHOD_SLUGS,
  REVIEW_STATES,
  REVIEW_STATE_SLUGS,
} from "@/constants/pull-requests";

const suffix = Date.now().toString(36);
const createdProjectIds: string[] = [];
const createdUserIds: string[] = [];
const tmpDirs: string[] = [];

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: "utf8" });
}

// Seeds a bare repo with two commits: main (base) and feature/x (head, one
// extra commit on top). Returns the head sha of feature/x.
async function seedRepo(barePath: string): Promise<string> {
  const workPath = path.join(tmpdir(), `sigit-pr-work-${suffix}-${Math.random().toString(36).slice(2)}`);
  tmpDirs.push(workPath);
  await fs.mkdir(workPath, { recursive: true });
  sh("git init -b main", workPath);
  sh('git config user.email "test@local"', workPath);
  sh('git config user.name "Test"', workPath);
  await fs.writeFile(path.join(workPath, "hello.txt"), "hi");
  sh("git add -A && git commit -m \"test: base commit\" -q", workPath);
  sh("git branch feature/x", workPath);
  sh("git checkout feature/x -q", workPath);
  await fs.writeFile(path.join(workPath, "feature.txt"), "new");
  sh("git add -A && git commit -m \"test: feature commit\" -q", workPath);
  const headSha = execSync("git rev-parse HEAD", { cwd: workPath, encoding: "utf8" }).trim();
  sh("git checkout main -q", workPath);
  sh(`git remote add sigit ${barePath}`, workPath);
  sh("git push sigit main feature/x -q", workPath);
  return headSha;
}

// Seeds a bare repo where feature/x and main both edit the same file after
// diverging, so a trial merge reports a conflict.
async function seedConflictRepo(barePath: string): Promise<void> {
  const workPath = path.join(tmpdir(), `sigit-pr-conflict-${suffix}-${Math.random().toString(36).slice(2)}`);
  tmpDirs.push(workPath);
  await fs.mkdir(workPath, { recursive: true });
  sh("git init -b main", workPath);
  sh('git config user.email "test@local"', workPath);
  sh('git config user.name "Test"', workPath);
  await fs.writeFile(path.join(workPath, "shared.txt"), "base\n");
  sh("git add -A && git commit -m \"test: base\" -q", workPath);
  sh("git branch feature/x", workPath);
  sh("git checkout feature/x -q", workPath);
  await fs.writeFile(path.join(workPath, "shared.txt"), "feature change\n");
  sh("git add -A && git commit -m \"test: feature edits shared\" -q", workPath);
  sh("git checkout main -q", workPath);
  await fs.writeFile(path.join(workPath, "shared.txt"), "main change\n");
  sh("git add -A && git commit -m \"test: main edits shared\" -q", workPath);
  sh(`git remote add sigit ${barePath}`, workPath);
  sh("git push sigit main feature/x -q", workPath);
}

async function createProjectRow(name: string): Promise<string> {
  const [row] = await db
    .insert(projects)
    .values({ name, encryptionKeyEncrypted: "pr-test-key" })
    .returning({ id: projects.id });
  createdProjectIds.push(row.id);
  return row.id;
}

async function createUserRow(email: string, role = "collaborator"): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: "pr-test-hash", role })
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
    // best effort cleanup, rows are namespaced by suffix
  }
});

describe("pull request constants", () => {
  it("every status slug is unique and has a display name", () => {
    const slugs = PR_STATUS_SLUGS.map(String);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const entry of Object.values(PR_STATUSES)) {
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  it("terminal statuses are exactly the non-open statuses", () => {
    const nonOpen = PR_STATUS_SLUGS.filter((s) => s !== PR_STATUSES.OPEN.slug);
    expect([...PR_TERMINAL_STATUSES].sort()).toEqual([...nonOpen].sort());
  });

  it("merge methods and review states have unique slugs and names", () => {
    expect(new Set(MERGE_METHOD_SLUGS).size).toBe(MERGE_METHOD_SLUGS.length);
    expect(new Set(REVIEW_STATE_SLUGS).size).toBe(REVIEW_STATE_SLUGS.length);
    for (const entry of [...Object.values(MERGE_METHODS), ...Object.values(REVIEW_STATES)]) {
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });
});

describe("pull request endpoints", () => {
  it("creates, lists, gets (with diff), closes, and deletes a PR", async () => {
    const projectId = await createProjectRow(`pr-${suffix}`);
    const barePath = projectRepoPath(projectId);
    await initRepo(barePath);
    const headSha = await seedRepo(barePath);

    const adminEmail = `pr-admin-${suffix}@sigit.test`;
    const adminId = await createUserRow(adminEmail, "admin");
    const { token } = await createSession(adminId);
    const headers = jsonHeaders(token);

    const created = await pullRequestRoutes.request(`/${projectId}/pull-requests`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Add feature", description: "Adds feature.txt", baseBranch: "main", headBranch: "feature/x" }),
    });
    expect(created.status).toBe(201);
    const pr = ((await created.json()) as { data: { number: number; status: string; baseSha: string; headSha: string; mergeableStatus: string } }).data;
    expect(pr.number).toBe(1);
    expect(pr.status).toBe("open");
    expect(pr.headSha).toBe(headSha);
    expect(pr.mergeableStatus).toBe("mergeable");

    const list = await pullRequestRoutes.request(`/${projectId}/pull-requests`, { headers });
    expect(list.status).toBe(200);
    const listed = ((await list.json()) as { data: { number: number }[] }).data;
    expect(listed).toHaveLength(1);
    expect(listed[0].number).toBe(1);

    const detail = await pullRequestRoutes.request(`/${projectId}/pull-requests/1`, { headers });
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as { data: { comments: unknown[]; reviews: unknown[]; author: { email: string } } };
    expect(detailBody.data.comments).toEqual([]);
    expect(detailBody.data.reviews).toEqual([]);
    expect(detailBody.data.author.email).toBe(adminEmail);

    const diffRes = await pullRequestRoutes.request(`/${projectId}/pull-requests/1/diff`, { headers });
    expect(diffRes.status).toBe(200);
    const diff = ((await diffRes.json()) as { diff: string }).diff;
    expect(diff).toContain("feature.txt");

    const closed = await pullRequestRoutes.request(`/${projectId}/pull-requests/1`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "closed" }),
    });
    expect(closed.status).toBe(200);
    const closedBody = (await closed.json()) as { data: { status: string; closedAt: string | null } };
    expect(closedBody.data.status).toBe("closed");
    expect(closedBody.data.closedAt).not.toBeNull();

    const reopen = await pullRequestRoutes.request(`/${projectId}/pull-requests/1`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "open" }),
    });
    expect(reopen.status).toBe(400);

    const deleted = await pullRequestRoutes.request(`/${projectId}/pull-requests/1`, { method: "DELETE", headers });
    expect(deleted.status).toBe(200);
    const afterDelete = await pullRequestRoutes.request(`/${projectId}/pull-requests/1`, { headers });
    expect(afterDelete.status).toBe(404);
  });

  it("rejects invalid PRs (same branch, missing branch, no merge base, no permission)", async () => {
    const projectId = await createProjectRow(`pr-perm-${suffix}`);
    const barePath = projectRepoPath(projectId);
    await initRepo(barePath);
    await seedRepo(barePath);

    const noPermEmail = `pr-noperm-${suffix}@sigit.test`;
    const noPermId = await createUserRow(noPermEmail);
    const { token } = await createSession(noPermId);
    const denied = await pullRequestRoutes.request(`/${projectId}/pull-requests`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ title: "nope", baseBranch: "main", headBranch: "feature/x" }),
    });
    expect(denied.status).toBe(403);

    const adminEmail = `pr-admin2-${suffix}@sigit.test`;
    const adminId = await createUserRow(adminEmail, "admin");
    const { token: adminToken } = await createSession(adminId);
    const headers = jsonHeaders(adminToken);

    const collabEmail = `pr-collab-${suffix}@sigit.test`;
    const collabId = await createUserRow(collabEmail);
    await db.insert(projectCollaborators).values({ projectId, userId: collabId, permissions: ["push"] });
    const { token: collabToken } = await createSession(collabId);
    const collabHeaders = jsonHeaders(collabToken);

    const same = await pullRequestRoutes.request(`/${projectId}/pull-requests`, {
      method: "POST",
      headers: collabHeaders,
      body: JSON.stringify({ title: "same", baseBranch: "main", headBranch: "main" }),
    });
    expect(same.status).toBe(400);

    const missing = await pullRequestRoutes.request(`/${projectId}/pull-requests`, {
      method: "POST",
      headers: collabHeaders,
      body: JSON.stringify({ title: "missing", baseBranch: "main", headBranch: "ghost" }),
    });
    expect(missing.status).toBe(400);

    const workPath = path.join(tmpdir(), `sigit-pr-work2-${suffix}-${Math.random().toString(36).slice(2)}`);
    tmpDirs.push(workPath);
    await fs.mkdir(workPath, { recursive: true });
    sh("git init -b unrelated", workPath);
    sh('git config user.email "test@local"', workPath);
    sh('git config user.name "Test"', workPath);
    await fs.writeFile(path.join(workPath, "other.txt"), "x");
    sh("git add -A && git commit -m \"test: unrelated history\" -q", workPath);
    sh("git remote add sigit2 " + barePath, workPath);
    sh("git push sigit2 unrelated -q", workPath);
    const noMergeBase = await pullRequestRoutes.request(`/${projectId}/pull-requests`, {
      method: "POST",
      headers: collabHeaders,
      body: JSON.stringify({ title: "unrelated", baseBranch: "main", headBranch: "unrelated" }),
    });
    expect(noMergeBase.status).toBe(400);

    // Missing PR -> 404 (needs view permission, so use the admin session)
    const missingPr = await pullRequestRoutes.request(`/${projectId}/pull-requests/99`, { headers });
    expect(missingPr.status).toBe(404);

    // The collab has only push: reading (detail/diff) is denied with 403
    const noView = await pullRequestRoutes.request(`/${projectId}/pull-requests/1`, { headers: collabHeaders });
    expect(noView.status).toBe(403);
    const noDiff = await pullRequestRoutes.request(`/${projectId}/pull-requests/1/diff`, { headers: collabHeaders });
    expect(noDiff.status).toBe(403);
  });

  it("marks a conflicting PR as conflict via the trial merge", async () => {
    const projectId = await createProjectRow(`pr-conflict-${suffix}`);
    const barePath = projectRepoPath(projectId);
    await initRepo(barePath);
    await seedConflictRepo(barePath);

    const adminEmail = `pr-conflict-admin-${suffix}@sigit.test`;
    const adminId = await createUserRow(adminEmail, "admin");
    const { token } = await createSession(adminId);
    const headers = jsonHeaders(token);

    const created = await pullRequestRoutes.request(`/${projectId}/pull-requests`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Conflicting", baseBranch: "main", headBranch: "feature/x" }),
    });
    expect(created.status).toBe(201);
    const pr = ((await created.json()) as { data: { mergeableStatus: string } }).data;
    expect(pr.mergeableStatus).toBe("conflict");

    // The merge endpoint still accepts (git decides), but the badge is red.
    const detail = await pullRequestRoutes.request(`/${projectId}/pull-requests/1`, { headers });
    const detailBody = (await detail.json()) as { data: { mergeableStatus: string } };
    expect(detailBody.data.mergeableStatus).toBe("conflict");
  });
});

describe("pull request conversation", () => {
  async function setupProject(label: string) {
    const projectId = await createProjectRow(`prconv-${label}-${suffix}`);
    const barePath = projectRepoPath(projectId);
    await initRepo(barePath);
    await seedRepo(barePath);
    const adminEmail = `prconv-${label}-admin-${suffix}@sigit.test`;
    const adminId = await createUserRow(adminEmail, "admin");
    const { token } = await createSession(adminId);
    const headers = jsonHeaders(token);
    const created = await pullRequestRoutes.request(`/${projectId}/pull-requests`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Conversation", baseBranch: "main", headBranch: "feature/x" }),
    });
    expect(created.status).toBe(201);
    return { projectId, token, headers };
  }

  it("adds comments and returns them in the PR detail", async () => {
    const { projectId, headers } = await setupProject("cmt");

    const first = await pullRequestRoutes.request(`/${projectId}/pull-requests/1/comments`, {
      method: "POST",
      headers,
      body: JSON.stringify({ body: "Nice change!" }),
    });
    expect(first.status).toBe(201);
    const comment = ((await first.json()) as { data: { id: string; body: string; author: { email: string } } }).data;
    expect(comment.body).toBe("Nice change!");
    expect(comment.author.email).toContain("prconv-cmt-admin");

    const detail = await pullRequestRoutes.request(`/${projectId}/pull-requests/1`, { headers });
    const body = (await detail.json()) as { data: { comments: { body: string; author: { email: string } }[] } };
    expect(body.data.comments).toHaveLength(1);
    expect(body.data.comments[0].body).toBe("Nice change!");
  });

  it("rejects an empty comment", async () => {
    const { projectId, headers } = await setupProject("empty");
    const res = await pullRequestRoutes.request(`/${projectId}/pull-requests/1/comments`, {
      method: "POST",
      headers,
      body: JSON.stringify({ body: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("upserts a review (latest state wins) and lists it in detail", async () => {
    const { projectId, headers } = await setupProject("review");

    const first = await pullRequestRoutes.request(`/${projectId}/pull-requests/1/reviews`, {
      method: "POST",
      headers,
      body: JSON.stringify({ state: "approve", body: "Looks good" }),
    });
    expect(first.status).toBe(201);
    const review = ((await first.json()) as { data: { state: string; body: string | null } }).data;
    expect(review.state).toBe("approve");
    expect(review.body).toBe("Looks good");

    // Same user submits again: the previous review is replaced, not duplicated.
    const second = await pullRequestRoutes.request(`/${projectId}/pull-requests/1/reviews`, {
      method: "POST",
      headers,
      body: JSON.stringify({ state: "request_changes", body: "Needs fixes" }),
    });
    expect(second.status).toBe(201);

    const detail = await pullRequestRoutes.request(`/${projectId}/pull-requests/1`, { headers });
    const body = (await detail.json()) as { data: { reviews: { state: string; body: string | null }[] } };
    expect(body.data.reviews).toHaveLength(1);
    expect(body.data.reviews[0].state).toBe("request_changes");
    expect(body.data.reviews[0].body).toBe("Needs fixes");
  });

  it("rejects an invalid review state", async () => {
    const { projectId, headers } = await setupProject("badstate");
    const res = await pullRequestRoutes.request(`/${projectId}/pull-requests/1/reviews`, {
      method: "POST",
      headers,
      body: JSON.stringify({ state: "lgtm" }),
    });
    expect(res.status).toBe(400);
  });

  it("denies comments without push permission", async () => {
    const { projectId } = await setupProject("noperm");
    const collabEmail = `prconv-noperm-${suffix}@sigit.test`;
    const collabId = await createUserRow(collabEmail);
    const { token } = await createSession(collabId);
    const res = await pullRequestRoutes.request(`/${projectId}/pull-requests/1/comments`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ body: "hi" }),
    });
    expect(res.status).toBe(403);
  });
});
