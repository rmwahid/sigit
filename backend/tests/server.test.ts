import { describe, expect, it, afterAll, mock } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { sha256 } from "@/lib/hash";
import { parseCgiHeaders, backupWithRetry } from "@/modules/git/server";
import { createConnectionFromInput, deleteConnection, getConnection } from "@/modules/storage/connections";
import { objectMeta } from "@/modules/storage/objects";
import { createProject, hardDeleteProject } from "@/modules/projects/projects";
import { backupObjectKey } from "@/modules/projects/backup";
import { createUser, deleteUser } from "@/modules/auth/auth";
import { ADMIN_ROLE } from "@/constants/roles";
import { TOKEN_SCOPES } from "@/constants/scopes";
import { createToken, revokeToken, setTokenProjectScopes } from "@/modules/auth/tokens";
import {
  buildBatchResponse,
  downloadObject,
  isValidOid,
  lfsObjectKey,
  uploadObject,
  verifyLfsContent,
  verifyObject,
} from "@/modules/lfs/server";

describe("lfs server (batch, oid verification, storage keys)", () => {
  it("builds storage key projects/{id}/lfs/{oid}", () => {
    expect(lfsObjectKey("proj-1", "abc123")).toBe("projects/proj-1/lfs/abc123");
  });

  it("validates oid format (64 hex)", () => {
    expect(isValidOid("a".repeat(64))).toBe(true);
    expect(isValidOid("A".repeat(64))).toBe(false); // uppercase is not valid
    expect(isValidOid("a".repeat(63))).toBe(false);
    expect(isValidOid("z".repeat(64))).toBe(false);
  });

  it("verifies content against oid (sha256)", () => {
    const content = Buffer.from("big file content");
    const oid = sha256(content);
    expect(verifyLfsContent(content, oid)).toBe(true);
    expect(verifyLfsContent(Buffer.from("tampered"), oid)).toBe(false);
  });

  it("builds upload batch with upload+verify actions", async () => {
    const oid = sha256(Buffer.from("x"));
    const payload = await buildBatchResponse({
      operation: "upload",
      objects: [{ oid, size: 1 }],
      baseUrl: "https://sigit.example/projects/my-repo.git/info/lfs/objects",
    });
    expect(payload.transfer).toBe("basic");
    const entry = payload.objects[0];
    expect(entry.oid).toBe(oid);
    expect(entry.authenticated).toBe(true);
    expect(entry.actions?.upload?.href).toBe(`https://sigit.example/projects/my-repo.git/info/lfs/objects/${oid}`);
    expect(entry.actions?.verify?.href).toBe(`https://sigit.example/projects/my-repo.git/info/lfs/objects/${oid}/verify`);
    expect(entry.actions?.download).toBeUndefined();
  });

  it("omits the upload action when the object exceeds the max size", async () => {
    const oid = sha256(Buffer.from("z"));
    const payload = await buildBatchResponse({
      operation: "upload",
      objects: [{ oid, size: 3 * 1024 * 1024 * 1024 }],
      baseUrl: "https://sigit.example/projects/my-repo.git/info/lfs/objects",
      maxObjectBytes: 2 * 1024 * 1024 * 1024,
    });
    expect(payload.objects[0].actions).toBeUndefined();
  });

  it("builds download batch with action only when object exists", async () => {
    const oid = sha256(Buffer.from("y"));
    const exists = async (o: string) => o === oid;
    const payload = await buildBatchResponse({
      operation: "download",
      objects: [{ oid, size: 1 }, { oid: "b".repeat(64), size: 2 }],
      baseUrl: "https://sigit.example/projects/my-repo.git/info/lfs/objects",
      exists,
    });
    expect(payload.objects[0].actions?.download?.href).toContain(oid);
    // second object missing in storage -> no action (spec: client must not retry)
    expect(payload.objects[1].actions).toBeUndefined();
  });
});

describe("git smart http CGI header parsing", () => {
  function cgiStream(raw: string): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(raw));
        controller.close();
      },
    });
  }

  it("parses status, headers, and the trailing body", async () => {
    const parsed = await parseCgiHeaders(cgiStream("Status: 200 OK\r\nContent-Type: application/x-git-upload-pack-advertisement\r\n\r\nBODY"));
    expect(parsed.status).toBe(200);
    expect(parsed.headers.get("content-type")).toBe("application/x-git-upload-pack-advertisement");

    const body = await new Response(parsed.body).text();
    expect(body).toBe("BODY");
  });

  it("splits the body across the header and the first read chunk", async () => {
    // Header separator lands mid-chunk: the leftover bytes are part of the body.
    const parsed = await parseCgiHeaders(cgiStream("Status: 201 Created\r\nX-Test: 1\r\n\r\nPART"));
    expect(parsed.status).toBe(201);
    expect(parsed.headers.get("x-test")).toBe("1");
    expect(await new Response(parsed.body).text()).toBe("PART");
  });

  it("defaults to status 200 when the CGI output has no Status line", async () => {
    const parsed = await parseCgiHeaders(cgiStream("Content-Length: 4\r\n\r\nDATA"));
    expect(parsed.status).toBe(200);
    expect(await new Response(parsed.body).text()).toBe("DATA");
  });

  it("throws when the stream ends before the header terminator", async () => {
    let message = "";
    try {
      await parseCgiHeaders(cgiStream("Status: 200 OK"));
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toBe("git http-backend returned no headers");
  });
});

// Full object lifecycle against local MinIO (bucket sigit-test):
// upload (oid-verified, encrypted at rest) -> verify (size) -> download.
const TEST_TIMEOUT = 30000;
const lfsSuffix = Date.now().toString(36);
const createdProjectIds: string[] = [];
const createdConnectionIds: string[] = [];

async function lfsFixture(): Promise<{
  project: Awaited<ReturnType<typeof createProject>>;
  connection: NonNullable<Awaited<ReturnType<typeof getConnection>>>;
}> {
  const connection = await createConnectionFromInput({
    name: `lfs-test-conn-${lfsSuffix}`,
    endpoint: "http://127.0.0.1:9000",
    region: "us-east-1",
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
    bucket: "sigit-test",
    forcePathStyle: true,
  });
  createdConnectionIds.push(connection.id);
  const stored = await getConnection(connection.id);
  if (!stored) throw new Error("test connection not found");
  const project = await createProject({ name: `lfs-${lfsSuffix}`, storageConnectionId: connection.id });
  createdProjectIds.push(project.id);
  return { project, connection: stored };
}

afterAll(async () => {
  for (const id of createdProjectIds) {
    try {
      await hardDeleteProject(id);
    } catch {
      // best effort
    }
  }
  for (const id of createdConnectionIds) {
    try {
      await deleteConnection(id);
    } catch {
      // best effort
    }
  }
}, TEST_TIMEOUT);

describe("lfs server object lifecycle (MinIO)", () => {
  it("uploads, verifies, and downloads an object with the oid contract", async () => {
    const { project, connection } = await lfsFixture();
    const content = Buffer.from("lfs lifecycle content");
    const oid = sha256(content);

    // Upload refuses content that does not hash to the declared oid.
    const bad = await uploadObject(project, connection, oid, Buffer.from("tampered"));
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("oid mismatch");

    // Before upload, verify reports the object as missing (and does not crash).
    const missing = await verifyObject(project, connection, oid, content.length);
    expect(missing.ok).toBe(false);
    expect(missing.error).toBe("object does not exist");

    const uploaded = await uploadObject(project, connection, oid, content);
    expect(uploaded.ok).toBe(true);

    const verified = await verifyObject(project, connection, oid, content.length);
    expect(verified.ok).toBe(true);

    // Wrong declared size -> rejected AND the object is garbage-collected.
    const wrongSize = await verifyObject(project, connection, oid, content.length + 1);
    expect(wrongSize.ok).toBe(false);
    expect(wrongSize.error).toBe("size mismatch: stored size != declared size");

    // Re-upload and download: plaintext round-trips through encrypted storage.
    const again = await uploadObject(project, connection, oid, content);
    expect(again.ok).toBe(true);
    const downloaded = await downloadObject(project, connection, oid);
    expect(downloaded?.equals(content)).toBe(true);
  });
});

describe("backup retry", () => {
  // Restore module overrides so later test files import the real
  // @/modules/projects/backup again.
  afterAll(() => {
    mock.restore();
  });

  it("retries transient failures, forwards the FULL project row, and stops on success", async () => {
    const attempts: number[] = [];
    let received: unknown = null;
    const fakeProject = { id: "project-x", name: "test", storageConnectionId: "conn-1" };
    mock.module("@/modules/projects/backup", () => ({
      backupProject: mock(async (project: unknown) => {
        received = project;
        attempts.push(attempts.length + 1);
        if (attempts.length < 2) throw new Error("storage down");
        return { key: "projects/x/backup.bundle", size: 1, head: null };
      }),
    }));
    // Re-import so the mock takes effect for this test.
    const { backupWithRetry } = await import("@/modules/git/server");
    await backupWithRetry(fakeProject as never);
    expect(attempts.length).toBe(2);
    // Regression guard: the whole project row must reach backupProject
    // (a bare {id} has no storageConnectionId and always fails).
    expect(received).toBe(fakeProject);
  });

  it("gives up after BACKUP_RETRIES and does not throw (logged instead)", async () => {
    let calls = 0;
    mock.module("@/modules/projects/backup", () => ({
      backupProject: mock(async () => {
        calls += 1;
        throw new Error("storage down");
      }),
    }));
    const { backupWithRetry } = await import("@/modules/git/server");
    await backupWithRetry({ id: "project-x", name: "test" } as never);
    expect(calls).toBe(3);
  });
});

// End-to-end guard for the auto-backup path: a REAL git push over HTTP must
// leave backup.bundle in the user storage. This is the exact regression that
// shipped once (backupWithRetry passed a bare {id}, so every auto backup
// failed silently with "Project has no storage connection") and no unit test
// could catch it, because none of them push through handleGitRequest.
describe("auto backup after real push over HTTP (MinIO)", () => {
  const suffix = `auto-${Date.now().toString(36)}`;
  const createdUserIds: string[] = [];
  const createdTokens: { id: string; userId: string }[] = [];

  it("stores an encrypted backup.bundle in user storage after git push", async () => {
    const connection = await createConnectionFromInput({
      name: `backup-e2e-conn-${suffix}`,
      endpoint: "http://127.0.0.1:9000",
      region: "us-east-1",
      accessKeyId: "minioadmin",
      secretAccessKey: "minioadmin",
      bucket: "sigit-test",
      forcePathStyle: true,
    });
    createdConnectionIds.push(connection.id);
    const stored = await getConnection(connection.id);
    if (!stored) throw new Error("test connection not found");
    const project = await createProject({ name: `backup-e2e-${suffix}`, storageConnectionId: connection.id });
    createdProjectIds.push(project.id);

    // Admin token with write scope (admin bypasses collaborator checks).
    const user = await createUser(`backup-e2e-${suffix}@test.local`, "password123", ADMIN_ROLE);
    createdUserIds.push(user.id);
    const { id: tokenId, token } = await createToken(user.id, `backup-e2e-tok-${suffix}`, new Date(Date.now() + 60 * 60 * 1000));
    createdTokens.push({ id: tokenId, userId: user.id });
    await setTokenProjectScopes(tokenId, [{ projectId: project.id, scope: TOKEN_SCOPES.WRITE.slug }]);

    // Boot the backend as a STANDALONE subprocess (same proven pattern as
    // e2e-lfs.ts / build-smoke.ts): in-process Bun.serve inside bun test
    // hangs real git clients mid-request on Windows.
    const PORT = 3977;
    const base = `http://127.0.0.1:${PORT}`;
    const server = Bun.spawn(["bun", "run", "src/index.ts"], {
      env: { ...process.env, PORT: String(PORT) },
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      let up = false;
      for (let i = 0; i < 50 && !up; i++) {
        try {
          const r = await fetch(`${base}/app-info`, { signal: AbortSignal.timeout(1500) });
          up = r.ok;
        } catch {
          // not up yet
        }
        if (!up) await Bun.sleep(300);
      }
      expect(up).toBe(true);

      // Same auth recipe as build-smoke: http.extraHeader (URL credentials
      // make git fall into the Windows credential-manager path, which hangs).
      const basic = "Basic " + Buffer.from(`sigit:${token}`).toString("base64");
      const work = path.join(tmpdir(), `sigit-backup-e2e-${suffix}`);
      fs.mkdirSync(work, { recursive: true });
      const sh = (args: string[], timeout = 10000): void => {
        const res = spawnSync("git", args, { cwd: work, encoding: "utf8", timeout });
        if (res.status !== 0) {
          throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
        }
      };

      sh(["init", "-b", "main"]);
      sh(["config", "user.email", "test@local"]);
      sh(["config", "user.name", "Test"]);
      fs.writeFileSync(path.join(work, "hello.txt"), "hello backup");
      sh(["add", "-A"]);
      sh(["commit", "-m", "test: auto backup e2e"]);

      const push = spawnSync(
        "git",
        ["-c", `http.extraHeader=Authorization: ${basic}`, "push", `${base}/projects/${project.name}.git`, "main"],
        { cwd: work, encoding: "utf8", timeout: 20000 }
      );
      expect(push.status).toBe(0);

      // The bundle is built asynchronously after receive-pack closes; poll
      // instead of sleeping a fixed time (slow CI / cold git spawn).
      const deadline = Date.now() + 15000;
      let meta: Awaited<ReturnType<typeof objectMeta>> = null;
      while (Date.now() < deadline) {
        meta = await objectMeta(stored, backupObjectKey(project.id));
        if (meta && meta.size > 0) break;
        await Bun.sleep(300);
      }
      expect(meta).not.toBeNull();
      expect(meta!.size).toBeGreaterThan(0);

      fs.rmSync(work, { recursive: true, force: true });
    } finally {
      server.kill();
      spawnSync("taskkill", ["/F", "/T", "/PID", String(server.pid)], { stdio: "ignore" });
    }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    for (const { id, userId } of createdTokens) {
      await revokeToken(id, userId).catch(() => undefined);
    }
    for (const id of createdUserIds) {
      await deleteUser(id).catch(() => undefined);
    }
  });
});
