// E2E LFS: Git LFS via git protocol + user storage (local MinIO).
// Prerequisites: MinIO running (http://127.0.0.1:9000, bucket sigit-test) + dev DB `sigit`.
// Starts its own server on port 3999 so it does not clash with the dev server.
//
// Flow: create project+connection (module) -> token write/read (module)
//   -> git lfs push via HTTP -> verify object in MinIO (projects/{id}/lfs/{oid})
//   -> clone + lfs pull -> sha256 identical -> read-only token rejected on push -> cleanup.
// Run: bun run e2e:lfs  (from repo/backend)
import { spawn } from "node:child_process";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { db } from "../config/db";
import { users } from "../db/schema/auth";
import { createProjectWithConnection, hardDeleteProject } from "../modules/projects/projects";
import { createToken, revokeToken, setTokenProjectScopes } from "../modules/auth/tokens";
import { deleteConnection, getConnection } from "../modules/storage/connections";
import { getObject, listAllObjects } from "../modules/storage/objects";
import { sha256 } from "../modules/lfs";
import { DEFAULT_LFS_SIZE_THRESHOLD } from "../db/schema/projects";

const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const THRESHOLD = DEFAULT_LFS_SIZE_THRESHOLD; // default lfsSizeThreshold project
const STORAGE = {
  name: "e2e-minio",
  endpoint: "http://127.0.0.1:9000",
  region: "us-east-1",
  accessKeyId: "minioadmin",
  secretAccessKey: "minioadmin",
  bucket: "sigit-test",
  forcePathStyle: true,
};

const suffix = Date.now().toString(36);
const projectName = `e2e-lfs-${suffix}`;
let server: ReturnType<typeof spawn> | undefined;

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: "utf8" });
}

function basicAuth(token: string): string {
  return "Basic " + Buffer.from(`x:${token}`).toString("base64");
}

async function waitForServer(timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return;
    } catch {
      // server not up yet, keep waiting
    }
    await Bun.sleep(300);
  }
  throw new Error("server tidak start dalam batas waktu");
}

function check(cond: boolean, label: string): void {
  if (!cond) throw new Error(`CHECK FAILED: ${label}`);
  console.log(`  ok: ${label}`);
}

async function main(): Promise<void> {
  console.log(`[e2e-lfs] project=${projectName}`);

  // 1. Server sendiri di port 3999
  server = spawn("bun", ["run", "src/index.ts"], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (d) => process.stdout.write(`[srv] ${d}`));
  server.stderr?.on("data", (d) => process.stderr.write(`[server] ${d}`));
  await waitForServer();
  console.log("[e2e-lfs] server up");

  // 2. Project + koneksi storage + token (via module, seperti user di UI)
  const { project, connectionId } = await createProjectWithConnection({
    name: projectName,
    connection: STORAGE,
  });
  const connection = await getConnection(connectionId);
  check(!!connection, "connection created");
  const admin = (await db.select().from(users))[0];
  check(!!admin, "admin user found");
  const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const writeTok = await createToken(admin.id, "e2e-write", expires);
  await setTokenProjectScopes(writeTok.id, [{ projectId: project.id, scope: "write" }]);
  const readTok = await createToken(admin.id, "e2e-read", expires);
  await setTokenProjectScopes(readTok.id, [{ projectId: project.id, scope: "read" }]);
  console.log("[e2e-lfs] project + tokens ready");

  // 3. Repo lokal: file 12MB (> threshold 10MB) -> git lfs push via HTTP
  const work = path.join(tmpdir(), `sigit-lfs-work-${suffix}`);
  await fs.mkdir(work, { recursive: true });
  const big = Buffer.alloc(THRESHOLD + 2 * 1024 * 1024, 0x5a);
  const bigOid = sha256(big);
  sh("git init -b main", work);
  sh('git config user.email "e2e@test"', work);
  sh('git config user.name "E2E"', work);
  sh("git lfs install --local", work);
  sh('git lfs track "*.bin"', work);
  await fs.writeFile(path.join(work, "big.bin"), big);
  await fs.writeFile(path.join(work, "README.md"), "# LFS E2E\n");
  sh("git add -A && git commit -m \"test: add big binary via lfs\" -q", work);
  sh(`git remote add sigit ${BASE}/projects/${projectName}.git`, work);
  sh(`git config http.extraHeader "Authorization: ${basicAuth(writeTok.token)}"`, work);
  sh("git push sigit main", work);
  console.log("[e2e-lfs] push done");

  // 4. Pointer in git history (not a 12MB blob) + object in user storage
  const objectKeys = await listAllObjects(connection!, `projects/${project.id}/lfs/`);
  check(objectKeys.length === 1, `LFS object stored in user storage: ${objectKeys[0] ?? "(none)"}`);
  check(objectKeys[0]?.endsWith(bigOid) === true, "object key = projects/{id}/lfs/{oid} (sha256 content)");

  // 5. At-rest encryption: raw bytes in MinIO are NOT the plaintext.
  const rawStored = await getObject(connection!, objectKeys[0]!);
  check(sha256(rawStored) !== bigOid, "object bytes at rest are encrypted (not plaintext)");

  // 6. Clone via HTTP + lfs pull -> content identical
  const cloneDir = path.join(tmpdir(), `sigit-lfs-clone-${suffix}`);
  sh(`git -c http.extraHeader="Authorization: ${basicAuth(readTok.token)}" clone ${BASE}/projects/${projectName}.git ${cloneDir}`, tmpdir());
  sh("git lfs pull", cloneDir);
  const pulled = await fs.readFile(path.join(cloneDir, "big.bin"));
  check(pulled.length === big.length && sha256(pulled) === bigOid, "content after clone + lfs pull is identical");
  console.log("[e2e-lfs] clone + pull done");

  // 7. Read-only token must not push (scope enforcement via git protocol).
  //    Clone first: git rejects unrelated-history pushes at the client before HTTP,
  //    so a fresh repo cannot exercise the scope middleware.
  const clone2 = path.join(tmpdir(), `sigit-lfs-ro-${suffix}`);
  sh(`git -c http.extraHeader="Authorization: ${basicAuth(writeTok.token)}" clone ${BASE}/projects/${projectName}.git ${clone2}`, tmpdir());
  await fs.writeFile(path.join(clone2, "new.txt"), "new");
  sh("git add -A && git commit -m \"test: read-only push attempt\" -q", clone2);
  sh(`git config http.extraHeader "Authorization: ${basicAuth(readTok.token)}"`, clone2);
  let rejected403 = false;
  try {
    sh("git push origin main", clone2);
  } catch (err) {
    rejected403 = ((err as { stderr?: string }).stderr ?? "").includes("403");
  }
  check(rejected403, "push with a read-only token rejected with HTTP 403");

  // 8. Cleanup
  await hardDeleteProject(project.id);
  await deleteConnection(connectionId);
  await revokeToken(writeTok.id, admin.id);
  await revokeToken(readTok.id, admin.id);
  await fs.rm(work, { recursive: true, force: true });
  await fs.rm(cloneDir, { recursive: true, force: true });
  await fs.rm(clone2, { recursive: true, force: true });
  console.log("[e2e-lfs] ALL PASS");
}

main()
  .catch((err) => {
    console.error("[e2e-lfs] FAIL:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => {
    server?.kill();
    process.exit(process.exitCode ?? 0);
  });
