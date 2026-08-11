import { describe, expect, it, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  commitFiles,
  ensureGitignore,
  getCommitFiles,
  getDiff,
  getLog,
  initRepo,
  resolveHead,
} from "../src/modules/projects/git";

const repoPath = path.join(tmpdir(), `sigit-git-test-${Date.now()}`);

afterAll(async () => {
  await fs.rm(repoPath, { recursive: true, force: true });
});

describe("git module", () => {
  it("initializes a repo on the main branch", async () => {
    await initRepo(repoPath);
    const head = await resolveHead(repoPath);
    expect(head).toBeNull(); // no commits yet
  });

  it("commits files and returns a 40-char hash", async () => {
    const { commitHash } = await commitFiles(
      repoPath,
      [{ relativePath: "readme.md", content: Buffer.from("# Hello\n") }],
      "test: initial commit"
    );
    expect(commitHash).toMatch(/^[0-9a-f]{40}$/);
    expect(await fs.readFile(path.join(repoPath, "readme.md"), "utf8")).toBe("# Hello\n");
  });

  it("getLog returns the commit history", async () => {
    await commitFiles(repoPath, [{ relativePath: "notes.txt", content: Buffer.from("note") }], "test: second commit");
    const log = await getLog(repoPath, 10);
    expect(log.length).toBe(2);
    expect(log[0].message).toBe("test: second commit");
    expect(log[1].message).toBe("test: initial commit");
  });

  it("getDiff shows the latest change", async () => {
    const diff = await getDiff(repoPath, "HEAD~1", "HEAD");
    expect(diff).toContain("notes.txt");
    expect(diff).toContain("+note");
  });

  it("getCommitFiles lists changed files with status", async () => {
    const head = await resolveHead(repoPath);
    const files = await getCommitFiles(repoPath, head!);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.path === "notes.txt")).toBe(true);
  });

  it("ensureGitignore appends .sigit/ when missing", async () => {
    await ensureGitignore(repoPath);
    const content = await fs.readFile(path.join(repoPath, ".gitignore"), "utf8");
    expect(content).toContain(".sigit/");
    // idempotent
    await ensureGitignore(repoPath);
    const again = await fs.readFile(path.join(repoPath, ".gitignore"), "utf8");
    expect(again.match(/\.sigit\//g)?.length).toBe(1);
  });
});
