import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// env.ts reads process.env at import time. All test files share one process,
// so assertions run in a SUBPROCESS with a private env (same pattern as the
// logger tests in this repo). The subprocess runs from tmpdir: bun would
// otherwise auto-load the backend .env and mask missing-variable failures.
// spawnSync (not execFileSync): bun's execFileSync does not throw on a
// non-zero exit in this version, so we inspect the status explicitly.
const backendRoot = path.resolve(import.meta.dir, "..");
const envModuleUrl = pathToFileURL(path.join(backendRoot, "src", "config", "env.ts")).href;
const IMPORT_LINE = `const { env } = await import(${JSON.stringify(envModuleUrl)});`;

function run(script: string): { stdout: string; status: number | null } {
  // Minimal env: the child must NOT inherit the test process env, because
  // bun test auto-loads the backend .env and DATABASE_URL would leak in.
  const res = spawnSync(process.execPath, ["-e", script], {
    cwd: os.tmpdir(),
    encoding: "utf8",
    env: { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" },
  });
  return { stdout: res.stdout ?? "", status: res.status };
}

function parseEnv(extraLines: string): Record<string, unknown> {
  const script = [
    'process.env.DATABASE_URL = "postgres://u:p@localhost:5432/sigit";',
    'process.env.ENCRYPTION_KEYS = \'{"v1":"aa"}\';',
    extraLines,
    IMPORT_LINE,
    'console.log("RESULT:" + JSON.stringify({ port: env.PORT, gitBase: env.GIT_BASE_URL, logDir: env.LOG_DIR, keys: Object.keys(env.ENCRYPTION_KEYS) }));',
  ].join("\n");
  const { stdout, status } = run(script);
  if (status !== 0) throw new Error(`subprocess exited ${status}: ${stdout}`);
  const line = stdout.split("\n").find((l) => l.startsWith("RESULT:"));
  if (!line) throw new Error(`no result line in subprocess output: ${stdout}`);
  return JSON.parse(line.slice("RESULT:".length));
}

function importFails(extraLines: string): boolean {
  const script = [extraLines, IMPORT_LINE].join("\n");
  return run(script).status !== 0;
}

describe("env schema (subprocess)", () => {
  it("applies defaults and parses required values", () => {
    const parsed = parseEnv("");
    expect(parsed.port).toBe("3000");
    expect(parsed.gitBase).toBe("http://localhost:3000");
    expect(parsed.logDir).toBe("./data/logs");
    expect(parsed.keys).toEqual(["v1"]);
  });

  it("honors explicit values", () => {
    const parsed = parseEnv('process.env.PORT = "3999";');
    expect(parsed.port).toBe("3999");
  });

  it("fails without DATABASE_URL", () => {
    expect(importFails('process.env.ENCRYPTION_KEYS = \'{"v1":"aa"}\';')).toBe(true);
  });

  it("fails on empty ENCRYPTION_KEYS", () => {
    expect(
      importFails('process.env.DATABASE_URL = "postgres://u:p@localhost:5432/sigit";\nprocess.env.ENCRYPTION_KEYS = "{}";')
    ).toBe(true);
  });
});
