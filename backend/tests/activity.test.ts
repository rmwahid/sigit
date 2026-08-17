import { afterAll, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inArray } from "drizzle-orm";
import { db } from "@/config/db";
import { users } from "@/db/schema/auth";
import { projects } from "@/db/schema/projects";
import { getCommitDays, getUserActivity, mergeDayCounts } from "@/modules/activity/activity";
import { initRepo } from "@/modules/projects/git";
import { projectRepoPath } from "@/modules/projects/projects";
import { exploreRoutes } from "@/routes/explore";

const DAY_MS = 24 * 60 * 60 * 1000;

const barePath = path.join(tmpdir(), `sigit-activity-${Date.now()}`);
const workPath = path.join(tmpdir(), `sigit-activity-work-${Date.now()}`);

function sh(cmd: string, cwd: string, env: Record<string, string> = {}): string {
  return execSync(cmd, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
}

// Local date key (YYYY-MM-DD) `days` days ago at noon, plus a matching
// GIT_AUTHOR_DATE/GIT_COMMITTER_DATE for commit().
function dayEnv(daysAgo: number): { key: string; env: Record<string, string> } {
  const d = new Date(Date.now() - daysAgo * DAY_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T12:00:00`;
  return { key: key.slice(0, 10), env: { GIT_AUTHOR_DATE: key, GIT_COMMITTER_DATE: key } };
}

describe("getCommitDays (bare repo)", () => {
  afterAll(async () => {
    await fs.rm(barePath, { recursive: true, force: true });
    await fs.rm(workPath, { recursive: true, force: true });
  });

  it("counts commits per day for one author email and respects the window", async () => {
    await initRepo(barePath);
    await fs.mkdir(workPath, { recursive: true });
    sh("git init -b main", workPath);
    sh('git config user.email "alice@local"', workPath);
    sh('git config user.name "Alice"', workPath);
    sh(`git remote add sigit ${barePath}`, workPath);

    const day1 = dayEnv(5);
    const day2 = dayEnv(40);
    const dayOld = dayEnv(400);

    await fs.writeFile(path.join(workPath, "a.txt"), "1\n");
    sh('git add . && git commit -m "one"', workPath, day1.env);
    await fs.writeFile(path.join(workPath, "a.txt"), "2\n");
    sh('git add . && git commit -m "two"', workPath, day1.env); // same day, second commit
    await fs.writeFile(path.join(workPath, "a.txt"), "3\n");
    sh('git add . && git commit -m "three"', workPath, day2.env);
    // Commit by another author on day1: must not be counted.
    sh('git config user.email "bob@local"', workPath);
    await fs.writeFile(path.join(workPath, "b.txt"), "b\n");
    sh('git add . && git commit -m "bob"', workPath, day1.env);
    // Commit outside the window (400 days ago) by alice: excluded by the
    // date filter. Committed LAST on purpose: its date precedes its parent's,
    // a non-monotonic chain that a --since walk would truncate entirely.
    sh('git config user.email "alice@local"', workPath);
    await fs.writeFile(path.join(workPath, "a.txt"), "4\n");
    sh('git add . && git commit -m "old"', workPath, dayOld.env);
    sh("git push sigit main", workPath);

    const since = new Date(Date.now() - 365 * DAY_MS).toISOString();
    const alice = await getCommitDays(barePath, "alice@local", since);
    expect(alice.get(day1.key)).toBe(2);
    expect(alice.get(day2.key)).toBe(1);
    expect(alice.has(dayOld.key)).toBe(false);

    const bob = await getCommitDays(barePath, "bob@local", since);
    expect(bob.get(day1.key)).toBe(1);
    expect(bob.has(day2.key)).toBe(false);
  });
});

describe("mergeDayCounts", () => {
  it("sums counts per date across repos", () => {
    const merged = mergeDayCounts([
      new Map([
        ["2026-08-10", 2],
        ["2026-08-11", 1],
      ]),
      new Map([["2026-08-10", 3]]),
    ]);
    expect(merged.get("2026-08-10")).toBe(5);
    expect(merged.get("2026-08-11")).toBe(1);
  });

  it("returns an empty map for an empty input", () => {
    expect(mergeDayCounts([]).size).toBe(0);
  });
});

// Integration: getUserActivity + GET /explore/users/:email/activity against
// the configured DB. Rows are namespaced by suffix and removed in afterAll.
describe("user activity across public projects (DB)", () => {
  const suffix = Date.now().toString(36);
  const email = `activity-${suffix}@local`;
  const createdProjectIds: string[] = [];
  let createdUserId = "";

  async function createProjectRow(name: string, isPublic: boolean): Promise<string> {
    const [row] = await db
      .insert(projects)
      .values({ name, isPublic, encryptionKeyEncrypted: "activity-test-key" })
      .returning({ id: projects.id });
    createdProjectIds.push(row.id);
    return row.id;
  }

  async function pushCommits(repoId: string, messages: string[]): Promise<string[]> {
    const repoPath = projectRepoPath(repoId);
    const work = path.join(tmpdir(), `sigit-activity-push-${suffix}-${messages.length}`);
    await fs.mkdir(work, { recursive: true });
    sh("git init -b main", work);
    sh(`git config user.email "${email}"`, work);
    sh('git config user.name "Activity Test"', work);
    sh(`git remote add sigit ${repoPath}`, work);
    const keys: string[] = [];
    for (const [i, message] of messages.entries()) {
      const day = dayEnv(3 + i);
      keys.push(day.key);
      await fs.writeFile(path.join(work, "f.txt"), `${message}\n`);
      sh(`git add . && git commit -m "${message}"`, work, day.env);
    }
    sh("git push sigit main", work);
    await fs.rm(work, { recursive: true, force: true });
    return keys;
  }

  afterAll(async () => {
    try {
      if (createdProjectIds.length > 0) {
        await db.delete(projects).where(inArray(projects.id, createdProjectIds));
      }
      if (createdUserId) {
        await db.delete(users).where(inArray(users.id, [createdUserId]));
      }
    } catch {
      // best effort cleanup, rows are namespaced by suffix so leftovers are harmless
    }
    for (const id of createdProjectIds) {
      await fs.rm(projectRepoPath(id), { recursive: true, force: true });
    }
  });

  it("counts commits from public projects only and serves the route", async () => {
    const [user] = await db
      .insert(users)
      .values({ email, passwordHash: "activity-test-hash" })
      .returning({ id: users.id });
    createdUserId = user.id;

    const pub = await createProjectRow(`activity-pub-${suffix}`, true);
    const priv = await createProjectRow(`activity-priv-${suffix}`, false);
    // Project without a repo on disk: must be skipped, not an error.
    await createProjectRow(`activity-empty-${suffix}`, true);

    await initRepo(projectRepoPath(pub));
    await initRepo(projectRepoPath(priv));
    const pubKeys = await pushCommits(pub, ["one", "two", "three"]);
    await pushCommits(priv, ["secret"]);

    const days = await getUserActivity(email);
    const byDate = new Map(days.map((d) => [d.date, d.count]));
    expect(byDate.get(pubKeys[0])).toBe(1);
    expect(byDate.get(pubKeys[1])).toBe(1);
    expect(byDate.get(pubKeys[2])).toBe(1);
    expect(days.every((d) => d.count >= 0)).toBe(true);

    const res = await exploreRoutes.request(`/users/${email}/activity`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { days: { date: string; count: number }[] } };
    expect(body.data.days).toEqual(days);

    const missing = await exploreRoutes.request("/users/nobody@local/activity");
    expect(missing.status).toBe(404);
  });
});
