import { appendFileSync, mkdirSync, existsSync, statSync, renameSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { env } from "../config/env";

const LOG_DIR = env.LOG_DIR;
const AUDIT_FILE = join(LOG_DIR, "audit.log");
const AUDIT_MAX_BYTES = Number(env.LOG_AUDIT_MAX_BYTES); // 5 MB
const AUDIT_MAX_FILES = Number(env.LOG_AUDIT_MAX_FILES);

try {
  mkdirSync(dirname(AUDIT_FILE), { recursive: true });
} catch {
  // ignore: logging is non-fatal
}

type Level = "info" | "warn" | "error";
type LogEntry = { ts: string; level: Level; scope: string; message: string; [k: string]: unknown };

// Ring buffer for request logs (in-memory only, NOT persisted). Bounded to avoid unbounded growth.
const RING_SIZE = Number(env.LOG_RING_SIZE);
const ring: LogEntry[] = [];

// SSE subscribers (callbacks to push live log lines).
const subscribers = new Set<(entry: LogEntry) => void>();

function ts(): string {
  return new Date().toISOString();
}

function emit(level: Level, scope: string, message: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = { ts: ts(), level, scope, message, ...meta };
  // Push to ring buffer (bounded)
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();
  // Notify SSE subscribers
  for (const fn of subscribers) {
    try {
      fn(entry);
    } catch {
      // ignore subscriber errors
    }
  }
  // Console
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

export const log = {
  info: (scope: string, message: string, meta?: Record<string, unknown>) => emit("info", scope, message, meta),
  warn: (scope: string, message: string, meta?: Record<string, unknown>) => emit("warn", scope, message, meta),
  error: (scope: string, message: string, meta?: Record<string, unknown>) => emit("error", scope, message, meta),
};

// --- Audit log with rotation ---

function rotateIfNeeded(): void {
  try {
    if (!existsSync(AUDIT_FILE)) return;
    const size = statSync(AUDIT_FILE).size;
    if (size < AUDIT_MAX_BYTES) return;
    // Rotate: audit.log -> audit.log.1 -> audit.log.2 -> ...
    for (let i = AUDIT_MAX_FILES - 1; i >= 1; i--) {
      const from = `${AUDIT_FILE}.${i}`;
      const to = `${AUDIT_FILE}.${i + 1}`;
      if (existsSync(from)) renameSync(from, to);
    }
    if (existsSync(AUDIT_FILE)) renameSync(AUDIT_FILE, `${AUDIT_FILE}.1`);
  } catch {
    // non-fatal
  }
}

function auditEntryLine(entry: Record<string, unknown>): string {
  return JSON.stringify({ ts: ts(), ...entry });
}

export function audit(event: string, meta: Record<string, unknown>): void {
  const entry = { event, ...meta };
  try {
    rotateIfNeeded();
    appendFileSync(AUDIT_FILE, auditEntryLine(entry) + "\n");
  } catch {
    // non-fatal: fall back to console
  }
  console.log(`[audit] ${JSON.stringify({ ts: ts(), ...entry })}`);
}

// --- Read audit log (for "load older" UI) ---

export function readAuditLog(limit = 200, beforeTs?: string): Record<string, unknown>[] {
  const files = [AUDIT_FILE, ...Array.from({ length: AUDIT_MAX_FILES }, (_, i) => `${AUDIT_FILE}.${i + 1}`)];
  const lines: { line: string; order: number }[] = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!existsSync(f)) continue;
    try {
      const content = readFileSync(f, "utf8");
      const ls = content.split("\n").filter(Boolean);
      // files[0] is newest; keep order so older rotations come after
      ls.forEach((l) => lines.push({ line: l, order: i }));
    } catch {
      // skip unreadable
    }
  }

  // Sort: newest first overall (audit.log newest, then .1, .2, ...)
  const parsed = lines
    .map(({ line, order }) => {
      try {
        return { data: JSON.parse(line) as Record<string, unknown>, order };
      } catch {
        return null;
      }
    })
    .filter((x): x is { data: Record<string, unknown>; order: number } => x !== null)
    .sort((a, b) => {
      // Same file: keep file order (append). Across files: audit.log(.0) is newest.
      if (a.order !== b.order) return a.order - b.order;
      return 0;
    })
    .reverse(); // newest first

  const filtered = beforeTs
    ? parsed.filter((p) => String(p.data.ts ?? "") < beforeTs)
    : parsed;

  return filtered.slice(0, limit).map((p) => p.data);
}

export function getRingBuffer(limit = 200): LogEntry[] {
  return ring.slice(-limit);
}

export function subscribe(fn: (entry: LogEntry) => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
