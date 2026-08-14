import { describe, expect, it, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { db } from "../src/config/db";
import { projects } from "../src/db/schema/projects";
import { projectCollaborators, users } from "../src/db/schema/auth";
import { MAX_FILE_BROWSER_BYTES } from "../src/constants/limits";
import { SESSION_COOKIE } from "../src/constants/protocol";
import {
  archive,
  initRepo,
  isValidFilePath,
  isValidRefName,
  listBranches,
  listTree,
  readFileAtRef,
  resolveDefaultBranch,
} from "../src/modules/projects/git";
import { projectRepoPath } from "../src/modules/projects/projects";
import { createSession } from "../src/modules/auth/auth";
import { browserRoutes } from "../src/routes/browser";

// Integration test: temp bare repos for the git plumbing helpers + DB rows
// for the HTTP access rules (public vs private vs collaborator permissions).
// All rows carry a unique suffix and are removed in afterAll (best effort).
const suffix = Date.now().toString(36);
const createdProjectIds: string[] = [];
const createdUserIds: string[] = [];
const tmpDirs: string[] = [];

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: "utf8" });
}

// Commit files into a work repo and push them into the bare repo (local path).
async function seedRepo(barePath: string, files: Record<string, string | Buffer>): Promise<void> {
  const workPath = path.join(tmpdir(), `sigit-browser-work-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  tmpDirs.push(workPath);
  await fs.mkdir(workPath, { recursive: true });
  sh("git init -b main", workPath);
  sh('git config user.email "test@local"', workPath);
  sh('git config user.name "Test"', workPath);
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(workPath, name);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
  sh("git add -A && git commit -m \"test: browser fixtures\" -q", workPath);
  sh(`git remote add sigit ${barePath}`, workPath);
  sh("git push sigit main -q", workPath);
}

async function createProjectRow(name: string, isPublic: boolean): Promise<string> {
  const [row] = await db
    .insert(projects)
    .values({ name, isPublic, encryptionKeyEncrypted: "browser-test-key" })
    .returning({ id: projects.id });
  createdProjectIds.push(row.id);
  return row.id;
}

async function createUserRow(email: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: "browser-test-hash" })
    .returning({ id: users.id });
  createdUserIds.push(row.id);
  return row.id;
}

function cookieHeader(token: string): Headers {
  return new Headers({ Cookie: `${SESSION_COOKIE}=${token}` });
}

afterAll(async () => {
  // Project/user deletes cascade to project_collaborators (onDelete cascade).
  try {
    for (const id of createdProjectIds) {
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

describe("git plumbing helpers (file browser)", () => {
  const barePath = path.join(tmpdir(), `sigit-browser-repo-${suffix}`);
  tmpDirs.push(barePath);

  it("lists branches, trees and blob content", async () => {
    await initRepo(barePath);
    const binary = Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00]);
    await seedRepo(barePath, {
      "README.md": "hello",
      "src/a.txt": "alpha",
      "src/b.bin": binary,
      "big.dat": Buffer.alloc(MAX_FILE_BROWSER_BYTES + 1, 0x78),
    });

    const branches = await listBranches(barePath);
    expect(branches).toContain("main");
    expect(await resolveDefaultBranch(barePath)).toBe("main");

    const root = await listTree(barePath, "HEAD");
    const names = root.map((e) => e.name);
    expect(names).toContain("README.md");
    expect(names).toContain("src");
    expect(root.find((e) => e.name === "src")?.type).toBe("tree");
    expect(root.find((e) => e.name === "README.md")?.type).toBe("blob");

    const src = await listTree(barePath, "HEAD", "src");
    expect(src.map((e) => e.name).sort()).toEqual(["a.txt", "b.bin"]);
  });

  it("reads text files and rejects missing + oversized ones", async () => {
    const text = await readFileAtRef(barePath, "HEAD", "README.md");
    expect(text.ok).toBe(true);
    if (text.ok) {
      expect(text.encoding).toBe("text");
      expect(text.content).toBe("hello");
    }

    const missing = await readFileAtRef(barePath, "HEAD", "nope.txt");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("not-found");

    const big = await readFileAtRef(barePath, "HEAD", "big.dat");
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.reason).toBe("too-large");
  });

  it("serves binary files as base64", async () => {
    const bin = await readFileAtRef(barePath, "HEAD", "src/b.bin");
    expect(bin.ok).toBe(true);
    if (bin.ok) {
      expect(bin.encoding).toBe("base64");
      expect(Buffer.from(bin.content, "base64").subarray(0, 2)).toEqual(Buffer.from([0x00, 0x01]));
    }
  });

  it("builds zip and tar.gz archives", async () => {
    const zip = await archive(barePath, "HEAD", "zip");
    expect([...zip.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const tgz = await archive(barePath, "HEAD", "tar.gz");
    expect([...tgz.subarray(0, 2)]).toEqual([0x1f, 0x8b]);
  });

  it("rejects option-like and revision-syntax refs/paths", () => {
    expect(isValidRefName("main")).toBe(true);
    expect(isValidRefName("refs/heads/main")).toBe(true);
    expect(isValidRefName("main..evil")).toBe(false);
    expect(isValidRefName("-n")).toBe(false);
    expect(isValidRefName("a:b")).toBe(false);
    expect(isValidRefName("main~1")).toBe(false);

    expect(isValidFilePath("src/a.txt")).toBe(true);
    expect(isValidFilePath("../secret")).toBe(false);
    expect(isValidFilePath("/etc/passwd")).toBe(false);
    expect(isValidFilePath("-flag")).toBe(false);
  });
});

describe("browser routes access rules", () => {
  it("anonymous: private project is 401, public project serves refs", async () => {
    const priv = await createProjectRow(`browser-priv-${suffix}`, false);
    const pub = await createProjectRow(`browser-pub-${suffix}`, true);

    const privateRes = await browserRoutes.request(`/${priv}/refs`);
    expect(privateRes.status).toBe(401);

    await initRepo(projectRepoPath(pub));
    const publicRes = await browserRoutes.request(`/${pub}/refs`);
    expect(publicRes.status).toBe(200);
    const body = (await publicRes.json()) as { data: { branches: string[]; head: string | null } };
    expect(Array.isArray(body.data.branches)).toBe(true);
    expect(body.data.head).toBeNull();
  });

  it("anonymous: activity is 401 even on public projects", async () => {
    const pub = await createProjectRow(`browser-act-${suffix}`, true);
    const res = await browserRoutes.request(`/${pub}/activity`);
    expect(res.status).toBe(401);
  });

  it("session user: needs the view permission (403 without, 200 with)", async () => {
    const email = `browser-user-${suffix}@sigit.test`;
    const userId = await createUserRow(email);
    const { token } = await createSession(userId);

    const noPerm = await createProjectRow(`browser-noperm-${suffix}`, true);
    await initRepo(projectRepoPath(noPerm));
    await db.insert(projectCollaborators).values({ projectId: noPerm, userId, permissions: [] });
    const denied = await browserRoutes.request(`/${noPerm}/refs`, { headers: cookieHeader(token) });
    expect(denied.status).toBe(403);

    const withView = await createProjectRow(`browser-view-${suffix}`, false);
    await initRepo(projectRepoPath(withView));
    await db.insert(projectCollaborators).values({ projectId: withView, userId, permissions: ["view"] });
    const allowed = await browserRoutes.request(`/${withView}/refs`, { headers: cookieHeader(token) });
    expect(allowed.status).toBe(200);
  });

  it("anonymous: public archive works, tree rejects traversal", async () => {
    const pub = await createProjectRow(`browser-arch-${suffix}`, true);
    await initRepo(projectRepoPath(pub));
    await seedRepo(projectRepoPath(pub), { "hello.txt": "hi" });

    const arch = await browserRoutes.request(`/${pub}/archive?format=zip`);
    expect(arch.status).toBe(200);
    const bytes = new Uint8Array(await arch.arrayBuffer());
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const bad = await browserRoutes.request(`/${pub}/tree?path=..`);
    expect(bad.status).toBe(400);
  });

  it("anonymous: public history works (Code + History are the public tabs)", async () => {
    const pub = await createProjectRow(`browser-hist-${suffix}`, true);
    await initRepo(projectRepoPath(pub));
    await seedRepo(projectRepoPath(pub), { "f.txt": "x" });

    const res = await browserRoutes.request(`/${pub}/history`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { head: string | null; commits: { hash: string }[] } };
    expect(body.data.commits.length).toBe(1);
  });
});
