import { api } from "./client";
import type { LogEntry } from "./types";

export async function getLogs(limit?: number, before?: string) {
  const qs = new URLSearchParams();
  if (limit) qs.set("limit", String(limit));
  if (before) qs.set("before", before);
  return api<{ data: LogEntry[] }>(`/admin/logs?${qs.toString()}`);
}

export function openLogStream(onEntry: (entry: LogEntry) => void): { close: () => void } {
  const es = new EventSource("/api/admin/logs/stream");
  es.onmessage = (ev) => {
    try {
      onEntry(JSON.parse(ev.data) as LogEntry);
    } catch {
      // ignore malformed
    }
  };
  return { close: () => es.close() };
}
