import { describe, expect, it, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execSync } from "node:child_process";
import { getCommitFiles, getDiff, getLog, initRepo, resolveHead } from "../src/modules/projects/git";

const barePath = path.join(tmpdir(), `sigit-git-test-${Date.now()}`);
const workPath = path.join(tmpdir(), `sigit-git-work-${Date.now()}`);

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: "utf8" });
}

afterAll(async () => {
  await fs.rm(barePath, { recursive: true, force: true });
  await fs.rm(workPath, { recursive: true, force: true });
});

describe("git module (bare repo)", () => {
  it("initializes a bare repo on main", async () => {
    await initRepo(barePath);
    const head = await resolveHead(barePath);
    expect(head).toBeNull(); // no commits yet
  });

  it("receives a push and exposes log/diff/commit-files", async () => {
    await fs.mkdir(workPath, { recursive: true });
    sh("git init -b main", workPath);
    sh('git config user.email "test@local"', workPath);
    sh('git config user.name "Test"', workPath);
    await fs.writeFile(path.join(workPath, "readme.md"), "# Hello\n");
    sh("git add . && git commit -m \"test: initial commit\"", workPath);
    sh(`git remote add sigit ${barePath}`, workPath);
    sh("git push sigit main", workPath);
    // commit kedua supaya getDiff("HEAD~1", "HEAD") valid
    await fs.writeFile(path.join(workPath, "readme.md"), "# Hello\n\nUpdated.\n");
    sh("git add . && git commit -m \"test: update readme\"", workPath);
    sh("git push sigit main", workPath);

    const head = await resolveHead(barePath);
    expect(head).toMatch(/^[0-9a-f]{40}$/);

    const log = await getLog(barePath, 10);
    expect(log.length).toBe(2);
    expect(log[0].message).toBe("test: update readme");
    expect(log[1].message).toBe("test: initial commit");

    const files = await getCommitFiles(barePath, head!);
    expect(files.some((f) => f.path === "readme.md")).toBe(true);

    const diff = await getDiff(barePath, "HEAD~1", "HEAD");
    expect(diff).toContain("readme.md");
    expect(diff).toContain("+Updated.");
  });

  it("pre-receive hook rejects blobs above the threshold", async () => {
    const smallBare = path.join(tmpdir(), `sigit-hook-${Date.now()}`);
    const smallWork = path.join(tmpdir(), `sigit-hook-work-${Date.now()}`);
    try {
      await initRepo(smallBare, 1024); // threshold 1 KB
      await fs.mkdir(smallWork, { recursive: true });
      sh("git init -b main", smallWork);
      sh('git config user.email "t@l"', smallWork);
      sh('git config user.name "T"', smallWork);
      // commit kecil dulu, lalu commit berisi blob besar
      await fs.writeFile(path.join(smallWork, "small.txt"), "ok");
      sh("git add . && git commit -m \"test: small first\" -q", smallWork);
      await fs.writeFile(path.join(smallWork, "big.bin"), Buffer.alloc(2048));
      sh("git add . && git commit -m \"test: big file\" -q", smallWork);
      sh(`git remote add sigit ${smallBare}`, smallWork);

      let rejected = false;
      try {
        sh("git push sigit main", smallWork);
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);

      // Buang commit berisi blob besar dari history lokal (reset), lalu push
      // commit kecil — harus diterima.
      sh("git reset --hard HEAD~1 -q", smallWork);
      sh("git push sigit main -q", smallWork);
      const log = await getLog(smallBare, 10);
      expect(log[0].message).toBe("test: small first");
    } finally {
      await fs.rm(smallBare, { recursive: true, force: true });
      await fs.rm(smallWork, { recursive: true, force: true });
    }
  });
});
