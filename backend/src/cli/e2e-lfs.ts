// E2E Tahap 2: Git LFS via git protocol + storage user (MinIO lokal).
// Prasyarat: MinIO jalan (http://127.0.0.1:9000, bucket sigit-test) + DB dev `sigit`.
// Menjalankan server sendiri di port 3999 supaya tidak bentrok dengan dev server.
//
// Alur: create project+connection (module) -> token write/read (module)
//   -> git lfs push via HTTP -> verifikasi objek di MinIO (projects/{id}/lfs/{oid})
//   -> clone + lfs pull -> sha256 sama -> token read ditolak push -> cleanup.
// Jalankan: bun run e2e:lfs  (dari repo/backend)
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
import { listAllObjects } from "../modules/storage/objects";
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
      // belum up, tunggu
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
  check(!!connection, "connection dibuat");
  const admin = (await db.select().from(users))[0];
  check(!!admin, "admin user ditemukan");
  const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const writeTok = await createToken(admin.id, "e2e-write", expires);
  await setTokenProjectScopes(writeTok.id, [{ projectId: project.id, scope: "write" }]);
  const readTok = await createToken(admin.id, "e2e-read", expires);
  await setTokenProjectScopes(readTok.id, [{ projectId: project.id, scope: "read" }]);
  console.log("[e2e-lfs] project + tokens siap");

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
  console.log("[e2e-lfs] push selesai");

  // 4. Pointer di history git (bukan blob 12MB) + objek di storage user
  const objectKeys = await listAllObjects(connection!, `projects/${project.id}/lfs/`);
  check(objectKeys.length === 1, `objek LFS tersimpan di storage user: ${objectKeys[0] ?? "(none)"}`);
  check(objectKeys[0]?.endsWith(bigOid) === true, "key objek = projects/{id}/lfs/{oid} (sha256 konten)");

  // 5. Clone via HTTP + lfs pull -> konten sama persis
  const cloneDir = path.join(tmpdir(), `sigit-lfs-clone-${suffix}`);
  sh(`git -c http.extraHeader="Authorization: ${basicAuth(readTok.token)}" clone ${BASE}/projects/${projectName}.git ${cloneDir}`, tmpdir());
  sh("git lfs pull", cloneDir);
  const pulled = await fs.readFile(path.join(cloneDir, "big.bin"));
  check(pulled.length === big.length && sha256(pulled) === bigOid, "konten setelah clone+lfs pull identik");
  console.log("[e2e-lfs] clone + pull selesai");

  // 6. Token read-only tidak boleh push (scope enforcement lewat git protocol).
  //    Clone dulu: git menolak push unrelated history di client sebelum HTTP,
  //    jadi fresh repo tidak bisa menguji scope middleware.
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
  check(rejected403, "push dengan token read-only ditolak HTTP 403");

  // 7. Cleanup
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
