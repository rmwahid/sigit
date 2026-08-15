import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { env } from "@/config/env";

// End-to-end test of the BUILD OUTPUT (dist/, produced by `bun run build`).
// Runs against an isolated scratch environment: fresh database, temp repo root,
// local MinIO. Steps: build -> migrate via the bundled runner -> boot the bundled
// server -> exercise auth, storage, projects, tokens, git push, LFS, backup and
// restore -> cleanup. Run with `bun run test:build`.
const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 3991;
const BASE = `http://127.0.0.1:${PORT}`;
const SCRATCH_DB = "sigit_deploy_test";
const TEST_ENCRYPTION_KEYS = '{"v1":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}';
const ADMIN_EMAIL = "e2e@deploy.test";
const COLLAB_EMAIL = "collab@deploy.test";
const PASSWORD = "password123";
const NEW_PASSWORD = "password456";

const results: string[] = [];
let fails = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`);
  if (!cond) fails++;
}

// Swaps the database name in a postgres URL (defaults to the "postgres" maintenance db).
function urlFor(url: string, database: string): string {
  return url.replace(/\/[^/]*$/, `/${database}`);
}

function scratchUrl(): string {
  return urlFor(env.DATABASE_URL, SCRATCH_DB);
}

async function minioAvailable(): Promise<boolean> {
  try {
    const r = await fetch("http://127.0.0.1:9000/minio/health/live");
    return r.status === 200;
  } catch {
    return false;
  }
}

async function waitForServer(child: ReturnType<typeof spawn>, runDir: string): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) break;
    try {
      const r = await fetch(`${BASE}/app-info`);
      if (r.status === 200) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.error("server did not start. log tail:");
  console.error(existsSync(path.join(runDir, "server.log")) ? readTail(path.join(runDir, "server.log")) : "(no log)");
  return false;
}

function readTail(file: string): string {
  let content = "";
  try {
    content = readFileSync(file, "utf8");
  } catch {
    // log not written yet
  }
  return content.split("\n").slice(-10).join("\n");
}

async function dropScratchDb(maint: postgres.Sql): Promise<void> {
  await maint`DROP DATABASE IF EXISTS ${maint(SCRATCH_DB)} WITH (FORCE)`.catch(() => {
    // ignore; best effort cleanup
  });
}

type ApiResult = { status: number; json: any; text: string };

async function runSuite(sql: postgres.Sql): Promise<void> {
  let cookie = "";
  const call = async (
    method: string,
    p: string,
    body?: unknown,
    headers: Record<string, string> = {}
  ): Promise<ApiResult> => {
    // LFS batch hrefs are absolute URLs; everything else is a server path.
    const url = p.startsWith("http") ? p : BASE + p;
    const r = await fetch(url, {
      method,
      headers: { "content-type": "application/json", cookie, ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const setCookie = r.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await r.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      // non-json response
    }
    return { status: r.status, json, text };
  };

  const pushCommit = (dir: string, message: string, basic: string): string => {
    writeFileSync(path.join(dir, "README.md"), `# bundle e2e\n\n${message}\n`);
    spawnSync("git", ["add", "."], { cwd: dir, stdio: "pipe" });
    spawnSync("git", ["commit", "-m", message], { cwd: dir, stdio: "pipe" });
    const res = spawnSync(
      "git",
      ["-c", `http.extraHeader=Authorization: ${basic}`, "push", `${BASE}/projects/deploy-e2e.git`, "main"],
      { cwd: dir, stdio: "pipe", encoding: "utf8" }
    );
    return `${res.stdout}\n${res.stderr}`.trim();
  };

  // --- Public endpoints ---
  let r = await call("GET", "/");
  ok("GET /", r.status === 200 && r.json?.message === "SiGit API", String(r.status));
  r = await call("GET", "/app-info");
  ok("GET /app-info", r.status === 200 && r.json?.data?.gitBaseUrl === BASE, r.json?.data?.gitBaseUrl);
  r = await call("GET", "/auth/bootstrap");
  ok("GET /auth/bootstrap (needsSetup false)", r.status === 200 && r.json?.data?.needsSetup === false);
  r = await call("GET", "/openapi.json");
  const pathCount = Object.keys(r.json?.paths ?? {}).length;
  ok("GET /openapi.json", r.status === 200 && pathCount >= 23, `${pathCount} paths`);
  r = await call("GET", "/nope");
  ok("GET /nope -> 404 NOT_FOUND format", r.status === 404 && r.json?.error?.code === "NOT_FOUND");
  r = await call("GET", "/explore/projects");
  ok("GET /explore/projects (anon, empty)", r.status === 200 && Array.isArray(r.json?.data), String(r.status));

  // --- Auth ---
  r = await call("POST", "/auth/login", { email: ADMIN_EMAIL, password: "wrong" });
  ok("POST /auth/login wrong -> 401 INVALID_CREDENTIALS", r.status === 401 && r.json?.error?.code === "INVALID_CREDENTIALS");
  r = await call("POST", "/auth/login", { email: ADMIN_EMAIL, password: PASSWORD });
  ok("POST /auth/login -> 200 + session cookie", r.status === 200 && cookie.startsWith("sigit_session="), String(r.status));
  r = await call("GET", "/auth/me");
  ok("GET /auth/me", r.status === 200 && r.json?.data?.email === ADMIN_EMAIL);
  r = await call("GET", "/users");
  ok("GET /users (admin)", r.status === 200 && Array.isArray(r.json?.data));
  r = await call("GET", "/invitations");
  ok("GET /invitations", r.status === 200 && Array.isArray(r.json?.data), String(r.status));
  r = await call("POST", "/invitations", { email: "invitee@deploy.test" });
  ok("POST /invitations (works without Resend key)", (r.status === 200 || r.status === 201) && r.json?.data?.email === "invitee@deploy.test", String(r.status));
  r = await call("GET", "/email-settings");
  ok("GET /email-settings", r.status === 200, String(r.status));
  r = await call("PUT", "/email-settings", { fromEmail: "SiGit <onboarding@resend.dev>" });
  ok("PUT /email-settings (display-name from)", r.status === 200, String(r.status));
  r = await call("GET", "/admin/logs");
  ok("GET /admin/logs", r.status === 200 && Array.isArray(r.json?.data), String(r.status));
  r = await call("GET", "/projects");
  ok("GET /projects (empty)", r.status === 200 && r.json?.data?.length === 0);
  r = await call("GET", "/tokens");
  ok("GET /tokens (empty)", r.status === 200 && r.json?.data?.length === 0);
  r = await call("GET", "/storage/connections");
  ok("GET /storage/connections (empty)", r.status === 200 && r.json?.data?.length === 0);

  // --- Storage connection + project ---
  r = await call("POST", "/storage/connections", {
    name: "MinIO E2E",
    endpoint: "http://127.0.0.1:9000",
    region: "us-east-1",
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
    bucket: "sigit-test",
    forcePathStyle: true,
  });
  const connectionId: string | undefined = r.json?.data?.id;
  ok("POST /storage/connections (MinIO)", (r.status === 200 || r.status === 201) && !!connectionId && r.json?.data?.hasSecret === true, String(r.status));

  r = await call("POST", "/projects", { name: "deploy-e2e", description: "bundle e2e", storageConnectionId: connectionId });
  const projectId: string | undefined = r.json?.data?.id;
  ok("POST /projects", (r.status === 200 || r.status === 201) && !!projectId, String(r.status));
  r = await call("GET", "/projects/" + projectId);
  ok("GET /projects/:id", r.status === 200 && r.json?.data?.name === "deploy-e2e");

  // --- Tokens: write + read scopes ---
  r = await call("POST", "/tokens", { name: "e2e-write", expiresInDays: 7, projects: [{ projectId, scope: "write" }] });
  const token: string | undefined = r.json?.data?.token;
  const tokenId: string | undefined = r.json?.data?.id;
  ok("POST /tokens (write scope)", (r.status === 200 || r.status === 201) && typeof token === "string" && token.startsWith("sigit_"), String(r.status));
  const basic = "Basic " + Buffer.from("x:" + token).toString("base64");

  r = await call("POST", "/tokens", { name: "e2e-read", expiresInDays: 7, projects: [{ projectId, scope: "read" }] });
  const readToken: string | undefined = r.json?.data?.token;
  const readTokenId: string | undefined = r.json?.data?.id;
  ok("POST /tokens (read scope)", (r.status === 200 || r.status === 201) && typeof readToken === "string", String(r.status));
  const readBasic = "Basic " + Buffer.from("x:" + readToken).toString("base64");

  // --- Git smart HTTP + read-only enforcement ---
  r = await call("GET", `/projects/deploy-e2e.git/info/refs?service=git-upload-pack`, undefined, { authorization: basic });
  ok("GET .git/info/refs (write token)", r.status === 200, String(r.status));
  r = await call("GET", `/projects/deploy-e2e.git/info/refs?service=git-upload-pack`, undefined, { authorization: readBasic });
  ok("GET .git/info/refs (read token)", r.status === 200, String(r.status));

  const lfsOid = createHash("sha256").update("e2e").digest("hex");
  r = await call("POST", "/projects/deploy-e2e.git/info/lfs/objects/batch", { operation: "upload", transfers: ["basic"], objects: [{ oid: lfsOid, size: 3 }] }, { authorization: readBasic });
  ok("read token: LFS upload batch -> 403", r.status === 403, String(r.status));
  r = await call("POST", "/projects/deploy-e2e.git/info/lfs/objects/batch", { operation: "download", transfers: ["basic"], objects: [{ oid: lfsOid, size: 3 }] }, { authorization: readBasic });
  ok("read token: LFS download batch -> 200", r.status === 200, String(r.status));
  r = await call("POST", "/projects/deploy-e2e.git/info/lfs/objects/batch", { operation: "upload", transfers: ["basic"], objects: [{ oid: lfsOid, size: 3 }] }, { authorization: basic });
  ok("write token: LFS upload batch", r.status === 200 && !!r.json?.objects?.[0]?.actions?.upload, String(r.status));

  // --- Git push (write token) + read token rejection ---
  const repoDir = mkdtempSync(path.join(os.tmpdir(), "sigit-push-"));
  let secondCommitPushed = false;
  try {
    spawnSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "pipe" });
    spawnSync("git", ["config", "user.email", ADMIN_EMAIL], { cwd: repoDir, stdio: "pipe" });
    spawnSync("git", ["config", "user.name", "e2e"], { cwd: repoDir, stdio: "pipe" });
    const first = pushCommit(repoDir, "first commit", basic);
    ok("git push (write token)", true, first.split("\n")[0]);

    const readAttempt = pushCommit(repoDir, "second commit (must be rejected)", readBasic);
    ok(
      "git push with read token -> rejected",
      /(fatal|error|403)/i.test(readAttempt) && !readAttempt.includes("main -> main"),
      readAttempt.split("\n").slice(-2).join(" | ")
    );
    r = await call("GET", `/projects/${projectId}/history?limit=10`);
    ok("read-token push did not land (still 1 commit)", r.json?.data?.commits?.length === 1, `${r.json?.data?.commits?.length ?? 0} commits`);

    const second = pushCommit(repoDir, "second commit", basic);
    secondCommitPushed = !second.includes("error") && !second.includes("fatal");
    ok("git push second commit (write token)", secondCommitPushed, second.split("\n").slice(-2).join(" | "));
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }

  // --- LFS object round-trip + encryption at rest ---
  const lfsContent = randomBytes(2048);
  const lfsOid2 = createHash("sha256").update(lfsContent).digest("hex");
  r = await call("POST", "/projects/deploy-e2e.git/info/lfs/objects/batch", { operation: "upload", transfers: ["basic"], objects: [{ oid: lfsOid2, size: lfsContent.length }] }, { authorization: basic });
  const uploadHref: string = r.json?.objects?.[0]?.actions?.upload?.href ?? "";
  const verifyHref: string = r.json?.objects?.[0]?.actions?.verify?.href ?? "";
  ok("LFS batch upload actions", r.status === 200 && uploadHref.length > 0 && verifyHref.length > 0, String(r.status));
  const uploadUrl = uploadHref.startsWith("http") ? uploadHref : BASE + uploadHref;
  let up = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": "application/octet-stream", authorization: basic }, body: lfsContent });
  ok("LFS PUT object (write token)", up.status === 200, String(up.status));
  r = await call("POST", verifyHref, { oid: lfsOid2, size: lfsContent.length }, { authorization: basic });
  ok("LFS POST verify (oid matches)", r.status === 200, String(r.status));
  const dl = await fetch(BASE + `/projects/deploy-e2e.git/info/lfs/objects/${lfsOid2}`, { headers: { authorization: basic } });
  const dlBytes = Buffer.from(await dl.arrayBuffer());
  ok("LFS GET object round-trip", dl.status === 200 && dlBytes.equals(lfsContent), String(dl.status));

  const badContent = Buffer.from("this does not match the oid");
  r = await call("POST", "/projects/deploy-e2e.git/info/lfs/objects/batch", { operation: "upload", transfers: ["basic"], objects: [{ oid: lfsOid2, size: badContent.length }] }, { authorization: basic });
  const badHref: string = r.json?.objects?.[0]?.actions?.upload?.href ?? "";
  const badUrl = badHref.startsWith("http") ? badHref : BASE + badHref;
  up = await fetch(badUrl, { method: "PUT", headers: { "content-type": "application/octet-stream", authorization: basic }, body: badContent });
  ok("LFS PUT mismatched oid -> 422", up.status === 422, String(up.status));

  const s3 = new S3Client({
    region: "us-east-1",
    endpoint: "http://127.0.0.1:9000",
    forcePathStyle: true,
    credentials: { accessKeyId: "minioadmin", secretAccessKey: "minioadmin" },
  });
  const atRest = await s3.send(new GetObjectCommand({ Bucket: "sigit-test", Key: `projects/${projectId}/lfs/${lfsOid2}` }));
  const atRestBytes = Buffer.from(await atRest.Body!.transformToByteArray());
  ok(
    "LFS object encrypted at rest (ciphertext != plaintext, +28 bytes)",
    atRestBytes.length === lfsContent.length + 28 && !atRestBytes.subarray(0, 16).equals(lfsContent.subarray(0, 16)),
    `${atRestBytes.length} vs ${lfsContent.length}`
  );

  // --- Backup + restore ---
  const headBundle = await s3.send(new HeadObjectCommand({ Bucket: "sigit-test", Key: `projects/${projectId}/backup.bundle` })).catch(() => null);
  ok("backup.bundle exists in storage after push", !!headBundle && (headBundle.ContentLength ?? 0) > 0, headBundle ? `${headBundle.ContentLength} bytes` : "missing");
  r = await call("POST", `/projects/${projectId}/backup`);
  ok("POST /projects/:id/backup", r.status === 200 && (r.json?.data?.size ?? 0) > 0, String(r.status));
  r = await call("POST", `/projects/${projectId}/restore`);
  ok("POST /projects/:id/restore", r.status === 200, String(r.status));
  r = await call("GET", `/projects/${projectId}/history?limit=10`);
  ok("history intact after restore", r.status === 200 && r.json?.data?.commits?.length >= 2, `${r.json?.data?.commits?.length ?? 0} commits`);

  // --- Browser endpoints ---
  r = await call("GET", `/projects/${projectId}/refs`);
  ok("GET /projects/:id/refs (branch main)", r.status === 200 && r.json?.data?.branches?.includes("main"), JSON.stringify(r.json?.data?.branches));
  r = await call("GET", `/projects/${projectId}/tree?ref=main`);
  ok("GET /projects/:id/tree (README.md)", r.status === 200 && r.json?.data?.entries?.some((e: any) => e.name === "README.md"));
  r = await call("GET", `/projects/${projectId}/blob?ref=main&path=README.md`);
  ok("GET /projects/:id/blob (content round-trip)", r.status === 200 && r.json?.data?.content?.includes("second commit") === true);
  r = await call("GET", `/projects/${projectId}/activity?limit=10`);
  ok("GET /projects/:id/activity", r.status === 200 && r.json?.data?.length >= 1, String(r.status));
  r = await call("GET", `/projects/${projectId}/archive?format=zip&ref=main`);
  ok("GET /projects/:id/archive (zip)", r.status === 200 && r.text.startsWith("PK"), String(r.status));

  // --- Collaborators ---
  const collabRows = await sql`select id from users where email = ${COLLAB_EMAIL}`;
  const collabUserId = collabRows[0]?.id as string | undefined;
  r = await call("POST", `/projects/${projectId}/collaborators`, { userId: collabUserId, permissions: ["view", "history"] });
  ok("POST /projects/:id/collaborators", (r.status === 200 || r.status === 201) && r.json?.data?.userId === collabUserId, String(r.status));
  r = await call("GET", `/projects/${projectId}/collaborators`);
  ok("GET /projects/:id/collaborators", r.status === 200 && r.json?.data?.length === 1, String(r.status));
  r = await call("PATCH", `/projects/${projectId}/collaborators/${collabUserId}`, { permissions: ["view"] });
  ok("PATCH collaborator permissions", r.status === 200 && r.json?.data?.permissions?.length === 1, String(r.status));
  r = await call("DELETE", `/projects/${projectId}/collaborators/${collabUserId}`);
  ok("DELETE collaborator", r.status === 200, String(r.status));
  r = await call("GET", `/projects/${projectId}/collaborators`);
  ok("collaborators list empty after delete", r.json?.data?.length === 0);

  // --- Invitation lifecycle (email-free via inviteLink) + collaborator session ---
  r = await call("POST", "/invitations", { email: "invitee@deploy.test" });
  const inviteLink: string = r.json?.data?.inviteLink ?? "";
  const inviteToken = inviteLink ? new URL(inviteLink).searchParams.get("token") ?? "" : "";
  ok(
    "POST /invitations returns inviteLink with token",
    (r.status === 200 || r.status === 201) && inviteToken.startsWith("sigit_invite_"),
    String(r.status)
  );
  ok("emailSent is false without a Resend key", r.json?.data?.emailSent === false, String(r.json?.data?.emailSent));

  r = await call("POST", "/invitations", { email: "revoked@deploy.test" });
  const revokedLink: string = r.json?.data?.inviteLink ?? "";
  const revokedToken = revokedLink ? new URL(revokedLink).searchParams.get("token") ?? "" : "";
  const revokedInviteId: string | undefined = r.json?.data?.id;
  r = await call("DELETE", "/invitations/" + revokedInviteId);
  ok("DELETE /invitations/:id (revoke)", r.status === 200, String(r.status));
  r = await call("POST", "/auth/invite/accept", { token: revokedToken, password: PASSWORD });
  ok("accept with revoked token -> 404", r.status === 404, String(r.status));

  // Expiry: new invitations live ~24 hours; expired tokens are rejected.
  r = await call("POST", "/invitations", { email: "expired@deploy.test" });
  const expiredToken = new URL(r.json?.data?.inviteLink ?? "http://x/").searchParams.get("token") ?? "";
  const expiredInviteId: string | undefined = r.json?.data?.id;
  r = await call("GET", "/invitations");
  const listedInvite = r.json?.data?.find((i: any) => i.id === expiredInviteId);
  const expiresAt = listedInvite ? new Date(listedInvite.expiresAt).getTime() : 0;
  ok(
    "invitation expires in ~24 hours",
    expiresAt > Date.now() + 23 * 3600 * 1000 && expiresAt < Date.now() + 25 * 3600 * 1000,
    listedInvite?.expiresAt
  );
  if (expiredInviteId) {
    await sql`update invitations set expires_at = now() - interval '1 minute' where id = ${expiredInviteId}`;
  }
  r = await call("GET", `/auth/invite?token=${encodeURIComponent(expiredToken)}`);
  ok("expired token: GET invite info -> 404", r.status === 404, String(r.status));
  r = await call("POST", "/auth/invite/accept", { token: expiredToken, password: PASSWORD });
  ok("expired token: accept -> 404", r.status === 404, String(r.status));
  r = await call("DELETE", "/invitations/" + expiredInviteId);
  ok("DELETE expired invitation", r.status === 200, String(r.status));

  const adminCookie = cookie;
  r = await call("POST", "/auth/invite/accept", { token: inviteToken, password: PASSWORD });
  ok(
    "POST /auth/invite/accept (auto-login as invitee)",
    r.status === 200 && r.json?.data?.email === "invitee@deploy.test" && r.json?.data?.role === "collaborator",
    String(r.status)
  );
  const inviteeUserId: string | undefined = r.json?.data?.id;
  const inviteeCookie = cookie;
  r = await call("GET", "/auth/me");
  ok("invitee session active after accept", r.json?.data?.email === "invitee@deploy.test");
  r = await call("GET", "/admin/logs");
  ok("collaborator: GET /admin/logs -> 403", r.status === 403, String(r.status));
  r = await call("GET", "/users");
  ok("collaborator: GET /users -> 403", r.status === 403, String(r.status));
  r = await call("DELETE", "/projects/" + projectId);
  ok("collaborator: DELETE project -> 403 (admin only)", r.status === 403, String(r.status));

  r = await call("POST", "/storage/connections", {
    name: "MinIO Invitee",
    endpoint: "http://127.0.0.1:9000",
    region: "us-east-1",
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
    bucket: "sigit-test",
    forcePathStyle: true,
  });
  const inviteeConnectionId: string | undefined = r.json?.data?.id;
  ok("collaborator: POST /storage/connections", (r.status === 200 || r.status === 201) && !!inviteeConnectionId, String(r.status));
  r = await call("POST", "/projects", { name: "collab-project", storageConnectionId: inviteeConnectionId });
  const collabProjectId: string | undefined = r.json?.data?.id;
  ok("collaborator: POST /projects (auto-collaborator)", (r.status === 200 || r.status === 201) && !!collabProjectId, String(r.status));

  cookie = adminCookie;
  r = await call("POST", `/projects/${projectId}/collaborators`, { userId: inviteeUserId, permissions: ["view", "history"] });
  ok("admin adds invitee as collaborator", r.status === 200 || r.status === 201, String(r.status));

  cookie = inviteeCookie;
  r = await call("GET", "/projects/" + projectId);
  ok("collaborator: GET project with view perm", r.status === 200 && r.json?.data?.name === "deploy-e2e", String(r.status));
  r = await call("GET", `/projects/${projectId}/refs`);
  ok("collaborator: refs with view perm", r.status === 200, String(r.status));
  r = await call("GET", `/projects/${projectId}/history?limit=10`);
  ok("collaborator: history with history perm", r.status === 200, String(r.status));
  r = await call("GET", `/projects/${projectId}/activity?limit=10`);
  ok("collaborator: activity with history perm", r.status === 200, String(r.status));

  cookie = adminCookie;
  r = await call("PATCH", `/projects/${projectId}/collaborators/${inviteeUserId}`, { permissions: ["view"] });
  ok("admin narrows invitee perms to view only", r.status === 200, String(r.status));
  cookie = inviteeCookie;
  r = await call("GET", `/projects/${projectId}/history?limit=10`);
  ok("collaborator: history -> 403 without history perm", r.status === 403, String(r.status));
  r = await call("GET", `/projects/${projectId}/activity?limit=10`);
  ok("collaborator: activity -> 403 without history perm", r.status === 403, String(r.status));
  r = await call("GET", `/projects/${projectId}/refs`);
  ok("collaborator: refs still 200 with view perm", r.status === 200, String(r.status));

  cookie = adminCookie;
  r = await call("DELETE", `/projects/${collabProjectId}`);
  ok("admin deletes collab-created project", r.status === 200, String(r.status));
  r = await call("DELETE", `/storage/connections/${inviteeConnectionId}`);
  ok("admin deletes invitee connection", r.status === 200, String(r.status));
  cookie = adminCookie;

  // --- Publish + explore + anonymous read ---
  r = await call("PATCH", `/projects/${projectId}`, { isPublic: true });
  ok("PATCH /projects/:id (public)", r.status === 200 && r.json?.data?.isPublic === true, String(r.status));
  r = await call("GET", "/explore/projects");
  ok("GET /explore/projects lists public project", r.json?.data?.some((p: any) => p.name === "deploy-e2e") === true);
  const anonCookie = cookie;
  cookie = "";
  r = await call("GET", `/projects/${projectId}/refs`);
  ok("anon GET /projects/:id/refs (public)", r.status === 200 && r.json?.data?.branches?.includes("main"), String(r.status));
  cookie = anonCookie;

  // --- Revoke tokens ---
  r = await call("DELETE", "/tokens/" + tokenId);
  ok("DELETE /tokens/:id (write token)", r.status === 200, String(r.status));
  r = await call("DELETE", "/tokens/" + readTokenId);
  ok("DELETE /tokens/:id (read token)", r.status === 200, String(r.status));
  r = await call("GET", "/tokens");
  ok("tokens list empty after revoke", r.json?.data?.length === 0);

  // --- Password change + revoke-all ---
  r = await call("POST", "/auth/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
  ok("POST /auth/change-password", r.status === 200, String(r.status));
  r = await call("POST", "/auth/login", { email: ADMIN_EMAIL, password: PASSWORD });
  ok("old password rejected after change", r.status === 401, String(r.status));
  r = await call("POST", "/auth/login", { email: ADMIN_EMAIL, password: NEW_PASSWORD });
  ok("new password accepted", r.status === 200, String(r.status));
  r = await call("POST", "/auth/revoke-all", { password: NEW_PASSWORD });
  ok("POST /auth/revoke-all", r.status === 200, String(r.status));

  // --- Cleanup ---
  r = await call("DELETE", `/projects/${projectId}`);
  ok("DELETE /projects/:id", r.status === 200, String(r.status));
  r = await call("DELETE", `/storage/connections/${connectionId}`);
  ok("DELETE /storage/connections/:id", r.status === 200, String(r.status));
  r = await call("GET", "/storage/connections");
  ok("connections list empty again", r.json?.data?.length === 0);
  r = await call("POST", "/auth/logout");
  ok("POST /auth/logout", r.status === 200, String(r.status));
  r = await call("GET", "/auth/me");
  ok("GET /auth/me after logout -> 401", r.status === 401, String(r.status));
}

async function main(): Promise<void> {
  console.log("SiGit build smoke test");

  if (!(await minioAvailable())) {
    console.error("FAIL: local MinIO is not running (expected at http://127.0.0.1:9000, minioadmin/minioadmin, bucket sigit-test). Start it first.");
    process.exit(1);
  }

  console.log("-> Building dist (bun run build)");
  const build = spawnSync("bun", ["run", "build"], { cwd: BACKEND_ROOT, stdio: "inherit", shell: true });
  if (build.status !== 0) {
    console.error("build failed");
    process.exit(1);
  }

  const runDir = mkdtempSync(path.join(os.tmpdir(), "sigit-build-smoke-"));
  const reposDir = path.join(runDir, "repos");
  mkdirSync(reposDir, { recursive: true });
  const deployDir = path.join(runDir, "deploy");
  for (const entry of ["dist", "drizzle", "package.json"]) {
    cpSync(path.join(BACKEND_ROOT, "dist", entry), path.join(deployDir, entry), { recursive: true });
  }

  const maint = postgres(urlFor(env.DATABASE_URL, "postgres"));
  const serverEnv = {
    ...process.env,
    PORT: String(PORT),
    DATABASE_URL: scratchUrl(),
    ENCRYPTION_KEYS: TEST_ENCRYPTION_KEYS,
    GIT_BASE_URL: BASE,
    SIGIT_PROJECTS_ROOT: reposDir,
    LOG_DIR: path.join(runDir, "logs"),
    NODE_ENV: "development",
  } as Record<string, string>;

  let server: ReturnType<typeof spawn> | null = null;
  let sql: postgres.Sql | null = null;
  try {
    await dropScratchDb(maint);
    await maint`CREATE DATABASE ${maint(SCRATCH_DB)}`;

    console.log("-> Migrating scratch db via bundled runner");
    const migrate = spawnSync("bun", ["dist/migrate.js"], { cwd: deployDir, env: serverEnv, stdio: "inherit", shell: true });
    if (migrate.status !== 0) {
      console.error("migrate failed");
      process.exit(1);
    }

    console.log("-> Seeding admin + collaborator users");
    sql = postgres(scratchUrl());
    const adminHash = await Bun.password.hash(PASSWORD);
    await sql`insert into users (email, password_hash, role) values (${ADMIN_EMAIL}, ${adminHash}, ${"admin"})`;
    await sql`insert into users (email, password_hash, role) values (${COLLAB_EMAIL}, ${adminHash}, ${"collaborator"})`;

    console.log("-> Booting bundled server");
    server = spawn("bun", ["dist/index.js"], {
      cwd: deployDir,
      env: serverEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const logStream = path.join(runDir, "server.log");
    let logBuffer = "";
    server.stdout?.on("data", (d) => {
      logBuffer += d.toString();
    });
    server.stderr?.on("data", (d) => {
      logBuffer += d.toString();
    });
    const started = await waitForServer(server, runDir);
    writeFileSync(logStream, logBuffer);
    if (!started) {
      console.error(readTail(logStream));
      process.exit(1);
    }

    await runSuite(sql);
  } finally {
    console.log("\n-> Cleaning up");
    if (server) {
      server.kill();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      spawnSync("taskkill", ["/F", "/T", "/PID", String(server.pid ?? "")], { stdio: "ignore" });
    }
    if (sql) await sql.end().catch(() => undefined);
    await dropScratchDb(maint);
    await maint.end().catch(() => undefined);
    rmSync(runDir, { recursive: true, force: true });
  }

  console.log(results.join("\n"));
  console.log(`\n${results.length - fails}/${results.length} passed`);
  process.exit(fails > 0 ? 1 : 0);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
