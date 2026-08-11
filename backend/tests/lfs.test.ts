import { describe, expect, it } from "bun:test";
import type { Project } from "../src/db/schema/projects";
import { createLfsPointer, parseLfsPointer, sha256, shouldUseLfs } from "../src/modules/lfs";

function makeProject(overrides: Partial<Pick<Project, "lfsSizeThreshold" | "lfsPatterns">> = {}): Project {
  return { lfsSizeThreshold: 10, lfsPatterns: null, ...overrides } as Project;
}

describe("lfs pointer", () => {
  it("creates a pointer and parses it back", () => {
    const oid = sha256(Buffer.from("hello"));
    const pointer = createLfsPointer(oid, 5);
    const parsed = parseLfsPointer(pointer);
    expect(parsed?.oid).toBe(oid);
    expect(parsed?.size).toBe(5);
  });

  it("returns null for non-pointer content", () => {
    expect(parseLfsPointer("just some text")).toBeNull();
  });

  it("returns null for pointer without oid or size", () => {
    expect(parseLfsPointer("version https://git-lfs.github.com/spec/v1\nsize 5\n")).toBeNull();
  });
});

describe("sha256", () => {
  it("produces a 64-char hex digest", () => {
    const hash = sha256(Buffer.from("hello"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(sha256(Buffer.from("hello"))).toBe(sha256(Buffer.from("hello")));
  });
});

describe("shouldUseLfs", () => {
  it("uses LFS when file size is at or above the threshold", () => {
    const project = makeProject({ lfsSizeThreshold: 10 });
    expect(shouldUseLfs(project, Buffer.alloc(10), "file.txt")).toBe(true);
    expect(shouldUseLfs(project, Buffer.alloc(9), "file.txt")).toBe(false);
  });

  it("uses LFS when path matches a configured pattern", () => {
    const project = makeProject({ lfsPatterns: "*.mp4, *.zip" });
    expect(shouldUseLfs(project, Buffer.from("small"), "video.mp4")).toBe(true);
    expect(shouldUseLfs(project, Buffer.from("small"), "archive.zip")).toBe(true);
    expect(shouldUseLfs(project, Buffer.from("small"), "notes.txt")).toBe(false);
  });

  it("does not treat the pattern as a prefix match", () => {
    const project = makeProject({ lfsPatterns: "*.mp4" });
    expect(shouldUseLfs(project, Buffer.from("small"), "video.mp4.backup")).toBe(false);
  });
});
