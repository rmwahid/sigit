import { describe, expect, it, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execSync } from "node:child_process";
import { prDiff, resolveRef, validatePrBranches } from "@/modules/pull-requests/pr";

// Paired unit test for modules/pull-requests/pr.ts: git validation + diff
// against real repos (no DB, no routes).
const suffix = Date.now().toString(36);
const tmpDirs: string[] = [];

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: "utf8" });
}

async function makeRepo(): Promise<string> {
  const dir = path.join(tmpdir(), `sigit-pr-unit-${suffix}-${Math.random().toString(36).slice(2)}`);
  tmpDirs.push(dir);
  await fs.mkdir(dir, { recursive: true });
  sh("git init -b main", dir);
  sh('git config user.email "test@local"', dir);
  sh('git config user.name "Test"', dir);
  return dir;
}

afterAll(async () => {
  for (const dir of tmpDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

describe("validatePrBranches", () => {
  it("accepts diverged branches", async () => {
    const dir = await makeRepo();
    await fs.writeFile(path.join(dir, "a.txt"), "a");
    sh("git add -A && git commit -m \"test: base\" -q", dir);
    sh("git branch feature/x", dir);
    sh("git checkout feature/x -q", dir);
    await fs.writeFile(path.join(dir, "b.txt"), "b");
    sh("git add -A && git commit -m \"test: head\" -q", dir);
    sh("git checkout main -q", dir);

    const res = await validatePrBranches(dir, "main", "feature/x");
    expect(res.ok).toBe(true);
  });

  it("rejects identical base and head", async () => {
    const dir = await makeRepo();
    await fs.writeFile(path.join(dir, "a.txt"), "a");
    sh("git add -A && git commit -m \"test: base\" -q", dir);
    const res = await validatePrBranches(dir, "main", "main");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("different");
  });

  it("rejects a missing branch", async () => {
    const dir = await makeRepo();
    await fs.writeFile(path.join(dir, "a.txt"), "a");
    sh("git add -A && git commit -m \"test: base\" -q", dir);
    const res = await validatePrBranches(dir, "main", "ghost");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("ghost");
  });

  it("rejects branches without a merge base", async () => {
    const dir = await makeRepo();
    await fs.writeFile(path.join(dir, "a.txt"), "a");
    sh("git add -A && git commit -m \"test: base\" -q", dir);
    sh("git checkout --orphan unrelated -q", dir);
    sh("git rm -rf . -q", dir);
    await fs.writeFile(path.join(dir, "u.txt"), "u");
    sh("git add -A && git commit -m \"test: unrelated\" -q", dir);
    sh("git checkout main -q", dir);

    const res = await validatePrBranches(dir, "main", "unrelated");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("merge base");
  });

  it("rejects revision expressions and option-like values as branches", async () => {
    const dir = await makeRepo();
    await fs.writeFile(path.join(dir, "a.txt"), "a");
    sh("git add -A && git commit -m \"test: base\" -q", dir);
    await fs.writeFile(path.join(dir, "b.txt"), "b");
    sh("git add -A && git commit -m \"test: second\" -q", dir);
    sh("git branch feature/x", dir);

    // Each of these resolves to a different revision than the ref it names, so
    // accepting one would let a stored field name one branch and act on another.
    for (const value of ["main~1", "main^", "main^{}", "main^{commit}", "feature/x~1", "-z"]) {
      const res = await validatePrBranches(dir, value, "feature/x");
      expect(res.ok).toBe(false);
      const head = await validatePrBranches(dir, "main", value);
      expect(head.ok).toBe(false);
    }

    expect((await validatePrBranches(dir, "main", "feature/x")).ok).toBe(true);

    // resolveRef is the exact-ref lookup the other paths share.
    expect(await resolveRef(dir, "main")).toMatch(/^[0-9a-f]{40}$/);
    let revisionRejected = false;
    try {
      await resolveRef(dir, "main~1");
    } catch {
      revisionRejected = true;
    }
    expect(revisionRejected).toBe(true);
  });
});

describe("prDiff", () => {
  it("returns the unified diff between base and head", async () => {
    const dir = await makeRepo();
    await fs.writeFile(path.join(dir, "a.txt"), "a");
    sh("git add -A && git commit -m \"test: base\" -q", dir);
    sh("git branch feature/x", dir);
    sh("git checkout feature/x -q", dir);
    await fs.writeFile(path.join(dir, "new.txt"), "new content\n");
    sh("git add -A && git commit -m \"test: head\" -q", dir);
    sh("git checkout main -q", dir);

    const diff = await prDiff(dir, "main", "feature/x");
    expect(diff).toContain("new.txt");
    expect(diff).toContain("+new content");
  });

  it("returns an empty diff for identical refs", async () => {
    const dir = await makeRepo();
    await fs.writeFile(path.join(dir, "a.txt"), "a");
    sh("git add -A && git commit -m \"test: base\" -q", dir);
    const diff = await prDiff(dir, "main", "main");
    expect(diff).toBe("");
  });

  it("returns the diff of a single commit (merged PR mode)", async () => {
    const dir = await makeRepo();
    await fs.writeFile(path.join(dir, "a.txt"), "a");
    sh("git add -A && git commit -m \"test: base\" -q", dir);
    await fs.writeFile(path.join(dir, "b.txt"), "b");
    sh("git add -A && git commit -m \"test: second\" -q", dir);
    const head = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
    const diff = await prDiff(dir, head);
    expect(diff).toContain("b.txt");
    expect(diff).toContain("+b");
  });

  it("truncates a diff past the caller cap instead of failing", async () => {
    const dir = await makeRepo();
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
    await fs.writeFile(path.join(dir, "a.txt"), "a");
    sh("git add -A && git commit -m \"test: base\" -q", dir);
    sh("git branch feature/x", dir);
    sh("git checkout feature/x -q", dir);
    await fs.writeFile(path.join(dir, "big.txt"), `${lines}\n`);
    sh("git add -A && git commit -m \"test: big head\" -q", dir);
    const head = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
    sh("git checkout main -q", dir);

    // Branch range and merged-PR (single commit) both honour the cap.
    const branchCapped = await prDiff(dir, "main", "feature/x", 512);
    expect(branchCapped).toContain("[diff truncated at 512 bytes]");
    expect(branchCapped.length).toBeLessThan(4096);

    const commitCapped = await prDiff(dir, head, undefined, 512);
    expect(commitCapped).toContain("[diff truncated at 512 bytes]");
  });
});
