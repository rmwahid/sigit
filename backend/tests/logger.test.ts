import { describe, expect, it, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

const logDir = path.join(tmpdir(), `sigit-logger-test-${Date.now()}`);

process.env.LOG_DIR = logDir;
process.env.LOG_RING_SIZE = "5";

const { log, getRingBuffer, readAuditLog, audit } = await import("../src/lib/logger");

afterAll(async () => {
  await fs.rm(logDir, { recursive: true, force: true });
});

describe("logger ring buffer", () => {
  it("keeps at most LOG_RING_SIZE entries", () => {
    for (let i = 0; i < 20; i++) {
      log.info("test", `entry ${i}`);
    }
    const ring = getRingBuffer();
    expect(ring.length).toBe(5);
    expect(ring[ring.length - 1].message).toBe("entry 19");
  });
});

describe("audit log", () => {
  it("writes audit entries readable by readAuditLog", () => {
    audit("test.write_audit", { key: "value" });
    const entries = readAuditLog(10);
    expect(entries.length).toBeGreaterThan(0);
    const last = entries[entries.length - 1];
    expect(last.event).toBe("test.write_audit");
    expect(last.key).toBe("value");
  });
});
