// Regression test for the command-injection findings (audit 2026-09-11).
// Two layers are covered:
//   1. git plumbing helpers must never interpret a ref/hash as shell syntax.
//   2. The HTTP routes must reject such values before they reach git.
// A marker file is used as the proof of execution: if any payload is ever
// interpreted by a shell again, the file appears and the test fails.
import { describe, expect, it, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { db } from "@/config/db";
import { projects } from "@/db/schema/projects";
import {
  getCommitFiles,
  getDiff,
  getLog,
  initRepo,
  isValidCommitHash,
  isValidRefName,
  resolveHead,
} from "@/modules/projects/git";
import { projectRepoPath } from "@/modules/projects/projects";
import { browserRoutes } from "@/routes/browser";

const suffix = Date.now().toString(36);
const createdProjectIds: string[] = [];
const tmpDirs: string[] = [];

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: "utf8" });
}

// Each payload would create the marker file if a shell interpreted it.
function payloads(marker: string): string[] {
  return [
    `main; touch "${marker}"`,
    `main & touch "${marker}"`,
    `main && touch "${marker}"`,
    `main | touch "${marker}"`,
    `main\`touch "${marker}"\``,
    `main$(touch "${marker}")`,
    `main" & touch "${marker}" & rem "`,
    `--upload-pack=touch ${marker}`,
  ];
}

async function markerExists(marker: string): Promise<boolean> {
  return fs.access(marker).then(() => true).catch(() => false);
}

afterAll(async () => {
  try {
    for (const id of createdProjectIds) {
      await db.delete(projects).where(eq(projects.id, id));
      await fs.rm(projectRepoPath(id), { recursive: true, force: true }).catch(() => {});
    }
    for (const dir of tmpDirs) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  } catch {
    // best effort cleanup
  }
});

describe("git helpers are shell-free (injection regression)", () => {
  const barePath = path.join(tmpdir(), `sigit-inj-repo-${suffix}`);
  const workPath = path.join(tmpdir(), `sigit-inj-work-${suffix}`);
  tmpDirs.push(barePath, workPath);

  it("seeds a repo with one commit", async () => {
    await initRepo(barePath);
    await fs.mkdir(workPath, { recursive: true });
    sh("git init -b main -q", workPath);
    sh('git config user.email "test@local"', workPath);
    sh('git config user.name "Test"', workPath);
    await fs.writeFile(path.join(workPath, "readme.md"), "# Hello\n");
    sh("git add -A && git commit -q -m \"test: seed\"", workPath);
    sh(`git remote add sigit ${barePath}`, workPath);
    sh("git push sigit main -q", workPath);
    expect(await resolveHead(barePath)).toMatch(/^[0-9a-f]{40}$/);
  });

  it("getLog does not execute a shell metacharacter in the ref", async () => {
    const marker = path.join(tmpdir(), `sigit-inj-log-${suffix}`);
    for (const payload of payloads(marker)) {
      // git may refuse the unknown revision; the point is that no shell runs.
      await getLog(barePath, 5, 0, payload).catch(() => []);
      expect(await markerExists(marker)).toBe(false);
    }
  });

  it("getCommitFiles does not execute a shell metacharacter in the hash", async () => {
    const marker = path.join(tmpdir(), `sigit-inj-files-${suffix}`);
    for (const payload of payloads(marker)) {
      await getCommitFiles(barePath, payload).catch(() => []);
      expect(await markerExists(marker)).toBe(false);
    }
  });

  it("getDiff does not execute a shell metacharacter in the hash", async () => {
    const marker = path.join(tmpdir(), `sigit-inj-diff-${suffix}`);
    for (const payload of payloads(marker)) {
      await getDiff(barePath, payload).catch(() => "");
      expect(await markerExists(marker)).toBe(false);
    }
  });

  it("still resolves a real ref and a real hash", async () => {
    const head = await resolveHead(barePath);
    expect((await getLog(barePath, 5, 0, "main")).length).toBe(1);
    expect((await getCommitFiles(barePath, head!)).some((f) => f.path === "readme.md")).toBe(true);
    expect((await getDiff(barePath, "HEAD")).length).toBeGreaterThan(0);
  });
});

describe("ref and hash validation", () => {
  it("rejects refs that git would read as options or shell syntax", () => {
    for (const bad of [
      "main; rm -rf /",
      "main && echo x",
      "$(whoami)",
      "`whoami`",
      "-DELETE",
      "--upload-pack=touch /tmp/x",
      "../etc/passwd",
      "main..other",
      "a b",
      "",
      "main|cat /etc/passwd",
    ]) {
      expect(isValidRefName(bad)).toBe(false);
    }
  });

  it("accepts normal branch and tag names", () => {
    for (const good of ["main", "master", "HEAD", "feature/x", "release-1.2.3", "v1.0.0", "a_b-c.d"]) {
      expect(isValidRefName(good)).toBe(true);
    }
  });

  it("accepts only object-id shaped commit hashes", () => {
    for (const good of ["HEAD", "abc1234", "4b825dc642cb6eb9a060e54bf8d69288fbee4904"]) {
      if (good === "HEAD") continue; // ref syntax is intentionally not a hash
      expect(isValidCommitHash(good)).toBe(true);
    }
    for (const bad of [
      "HEAD",
      "main~1",
      "main",
      "abc",
      "main; touch /tmp/x",
      "main\" & echo x & rem \"",
      "-abc123",
      "../../etc/passwd",
      "abc123 ",
    ]) {
      expect(isValidCommitHash(bad)).toBe(false);
    }
  });
});

describe("browser history route rejects an unsafe ref", () => {
  it("returns 400 for injection payloads and 200 for a real ref", async () => {
    const [project] = await db
      .insert(projects)
      .values({ name: `inj-route-${suffix}`, isPublic: true, encryptionKeyEncrypted: "inj-test-key" })
      .returning({ id: projects.id });
    createdProjectIds.push(project.id);

    // Seed the repo attached to the project row.
    const repoPath = projectRepoPath(project.id);
    tmpDirs.push(repoPath);
    await initRepo(repoPath);
    const work = path.join(tmpdir(), `sigit-inj-route-work-${suffix}`);
    tmpDirs.push(work);
    await fs.mkdir(work, { recursive: true });
    sh("git init -b main -q", work);
    sh('git config user.email "t@l"', work);
    sh('git config user.name "T"', work);
    await fs.writeFile(path.join(work, "a.txt"), "a\n");
    sh("git add -A && git commit -q -m \"test: seed\"", work);
    sh(`git remote add sigit ${repoPath}`, work);
    sh("git push sigit main -q", work);

    // Anonymous request: the project is public, so no session is needed at all.
    // Unsafe ref: rejected before reaching git.
    for (const ref of ["main; touch /tmp/pwned", "main && id", "$(id)", "-DELETE", "main|x"]) {
      const res = await browserRoutes.fetch(
        new Request(`http://localhost/${project.id}/history?ref=${encodeURIComponent(ref)}`)
      );
      expect(res.status).toBe(400);
    }

    // Safe ref: the normal path still works.
    const ok = await browserRoutes.fetch(
      new Request(`http://localhost/${project.id}/history?ref=main`)
    );
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { data: { commits: unknown[] } };
    expect(body.data.commits.length).toBe(1);
  });
});
