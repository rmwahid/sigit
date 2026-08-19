import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Assembles a self-contained deploy folder (dist/) in the Pralumex
// style: every server entrypoint bundled with `bun build --target bun` (npm
// dependencies included, so the server needs no node_modules), migrations
// copied as data, and a minimal package.json whose scripts point at the
// bundles. The .env file intentionally stays on the server.
const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = path.join(BACKEND_ROOT, "dist");

export type BundleTarget = { entry: string; outFile: string };

export const BUNDLE_TARGETS: BundleTarget[] = [
  { entry: "src/index.ts", outFile: "index.js" },
  { entry: "src/db/migrations/migration-runner.ts", outFile: "migrate.js" },
  { entry: "src/cli/create-admin.ts", outFile: "create-admin.js" },
  { entry: "src/cli/reset-password.ts", outFile: "reset-password.js" },
  { entry: "src/cli/reencrypt-secrets.ts", outFile: "reencrypt-secrets.js" },
];

export function buildMinimalPackageJson(original: {
  name: string;
  version: string;
}): string {
  const minimal = {
    name: original.name,
    version: original.version,
    type: "module",
    scripts: {
      start: "bun dist/index.js",
      "db:migrate": "bun dist/migrate.js",
      "db:create-admin": "bun dist/create-admin.js",
      "db:reset-password": "bun dist/reset-password.js",
      "db:reencrypt": "bun dist/reencrypt-secrets.js",
    },
  };
  return JSON.stringify(minimal, null, 2) + "\n";
}

function step(msg: string): void {
  console.log(`\n-> ${msg}`);
}

async function clean(): Promise<void> {
  step(`Cleaning ${OUT_DIR}`);
  await rm(OUT_DIR, { recursive: true, force: true }).catch(async (err) => {
    // Windows: the folder cannot be removed while a shell has it as its cwd
    // (EBUSY). Fall back to emptying its children; the folder itself is reused.
    if ((err as NodeJS.ErrnoException).code !== "EBUSY" && (err as NodeJS.ErrnoException).code !== "EPERM") throw err;
    for (const child of readdirSync(OUT_DIR)) {
      await rm(path.join(OUT_DIR, child), { recursive: true, force: true });
    }
  });
  await mkdir(path.join(OUT_DIR, "dist"), { recursive: true });
}

function bundle(): void {
  for (const { entry, outFile } of BUNDLE_TARGETS) {
    step(`Bundling ${entry} -> dist/dist/${outFile}`);
    const result = spawnSync(
      "bun",
      ["build", entry, "--outfile", path.join(OUT_DIR, "dist", outFile), "--target", "bun"],
      { cwd: BACKEND_ROOT, stdio: "inherit", shell: true }
    );
    if (result.status !== 0) {
      throw new Error(`bun build (${entry}) failed with exit code ${result.status}`);
    }
  }
}

async function copyMigrations(): Promise<void> {
  step("Copying migrations -> dist/drizzle/");
  const src = path.join(BACKEND_ROOT, "src", "db", "migrations");
  const dest = path.join(OUT_DIR, "drizzle");
  await mkdir(dest, { recursive: true });
  for (const file of readdirSync(src)) {
    if (file.endsWith(".sql")) {
      await cp(path.join(src, file), path.join(dest, file));
      console.log(`  ${file}`);
    }
  }
  await cp(path.join(src, "meta"), path.join(dest, "meta"), { recursive: true });
  console.log("  meta/");
}

async function writeMinimalPackageJson(): Promise<void> {
  step("Writing minimal package.json");
  const original = JSON.parse(
    await readFile(path.join(BACKEND_ROOT, "package.json"), "utf8")
  ) as { name: string; version: string };
  await writeFile(
    path.join(OUT_DIR, "package.json"),
    buildMinimalPackageJson(original),
    "utf8"
  );
  console.log("  package.json (start + db:* scripts)");
}

async function main(): Promise<void> {
  const start = Date.now();
  await clean();
  bundle();
  await copyMigrations();
  await writeMinimalPackageJson();
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`\nBuild complete in ${elapsed}s -> ${OUT_DIR}`);
  console.log("Deploy it as-is: the bundles include their npm dependencies.");
  console.log("Create .env on the server (SOPS decrypt or manually); it is not included here.");
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  await main();
}
