import { api } from "./client";
import type { LogEntry } from "./types";
import { API_BASE, API_PATHS } from "../constants/paths";

export async function getLogs(limit?: number, before?: string) {
  const qs = new URLSearchParams();
  if (limit) qs.set("limit", String(limit));
  if (before) qs.set("before", before);
  return api<{ data: LogEntry[] }>(`${API_PATHS.ADMIN_LOGS}?${qs.toString()}`);
}

export function openLogStream(onEntry: (entry: LogEntry) => void): { close: () => void } {
  const es = new EventSource(`${API_BASE}${API_PATHS.ADMIN_LOGS_STREAM}`);
  es.onmessage = (ev) => {
    try {
      onEntry(JSON.parse(ev.data) as LogEntry);
    } catch {
      // ignore malformed
    }
  };
  return { close: () => es.close() };
}
