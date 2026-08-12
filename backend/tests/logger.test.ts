// Logger tests run in a SUBPROCESS: bun test executes all files in ONE process,
// so env (LOG_RING_SIZE, LOG_DIR) and the logger.ts module cache are shared
// across test files - direct assertions would race with audit events from
// other files (e.g. "storage.delete_connection").
// The subprocess guarantees private env & state; results are sent via JSON on stdout.
import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const loggerPath = path.join(process.cwd(), "src", "lib", "logger").replace(/\\/g, "/");

const SCRIPT = `
import { log, getRingBuffer, readAuditLog, audit } from "${loggerPath}";
for (let i = 0; i < 20; i++) log.info("test", \`entry \${i}\`);
const ring = getRingBuffer();
audit("test.write_audit", { key: "value" });
const entries = readAuditLog(10);
const last = entries[entries.length - 1] ?? {};
console.log(JSON.stringify({ ringLen: ring.length, lastMsg: ring[ring.length - 1]?.message ?? null, auditEvent: last.event ?? null, auditKey: last.key ?? null }));
process.exit(0);
`;

function runInSubprocess(): Record<string, unknown> {
  const logDir = path.join(tmpdir(), `sigit-logger-sub-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const out = execFileSync(process.execPath, ["-e", SCRIPT], {
    cwd: process.cwd(),
    env: { ...process.env, LOG_RING_SIZE: "5", LOG_DIR: logDir },
    encoding: "utf8",
  });
  // Last line = result JSON; other lines = console logs from the subprocess.
  return JSON.parse(out.trim().split("\n").pop()!) as Record<string, unknown>;
}

describe("logger ring buffer", () => {
  it("keeps at most LOG_RING_SIZE entries", () => {
    const result = runInSubprocess();
    expect(result.ringLen).toBe(5);
    expect(result.lastMsg).toBe("entry 19");
  });
});

describe("audit log", () => {
  it("writes audit entries readable by readAuditLog", () => {
    const result = runInSubprocess();
    expect(result.auditEvent).toBe("test.write_audit");
    expect(result.auditKey).toBe("value");
  });
});
