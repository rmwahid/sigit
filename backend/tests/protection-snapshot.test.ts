// Paired test for modules/projects/protection-snapshot.ts: the snapshot path
// derivation and read/write round-trip. The path must match what the
// pre-receive hook computes (repo sibling _protection/<name>.snapshot).
import { describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { protectionSnapshotPath, readProtectionSnapshot, writeProtectionSnapshot } from "@/modules/projects/protection-snapshot";

describe("protection snapshot", () => {
  it("derives the path next to the repo (sibling _protection folder)", () => {
    const repo = path.join(tmpdir(), "sigit-snap-test", "repo123");
    const p = protectionSnapshotPath(repo);
    expect(path.basename(p)).toBe("repo123.snapshot");
    expect(path.basename(path.dirname(p))).toBe("_protection");
    expect(path.dirname(path.dirname(p))).toBe(path.dirname(repo));
  });

  it("round-trips write -> read", async () => {
    const repo = path.join(tmpdir(), `sigit-snap-rw-${Date.now()}`, "abc");
    const content = "pattern=main\nrequirePr=true\n\n";
    await writeProtectionSnapshot(repo, content);
    expect(await readProtectionSnapshot(repo)).toBe(content);
    await fs.rm(path.dirname(repo), { recursive: true, force: true });
  });

  it("returns null for a missing snapshot", async () => {
    const repo = path.join(tmpdir(), `sigit-snap-miss-${Date.now()}`, "def");
    expect(await readProtectionSnapshot(repo)).toBeNull();
  });
});
