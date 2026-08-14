import { api } from "./client";
import { API_BASE } from "../constants/paths";

// File browser API (routes/browser.ts): tree, blob, refs, archive, history
// pagination and the activity feed. Access is per request: session user with
// the right permission, or anonymous for public projects.

export type RefInfo = { branches: string[]; head: string | null; defaultBranch: string | null };

export type TreeEntry = { name: string; type: "blob" | "tree"; mode: string; hash: string };

export type TreeResponse = { ref: string; path: string; entries: TreeEntry[] };

export type BlobResponse = { path: string; size: number; encoding: "text" | "base64"; content: string };

export type CommitInfo = { hash: string; date: string; message: string; author: string };

export type HistoryPage = { head: string | null; commits: CommitInfo[] };

export type ActivityItem = { type: "commit" | "event"; ts: string; [key: string]: unknown };

export function getRefs(id: string) {
  return api<{ data: RefInfo }>(`/projects/${id}/refs`);
}

export function getTree(id: string, ref: string, dirPath = "") {
  const q = `ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(dirPath)}`;
  return api<{ data: TreeResponse }>(`/projects/${id}/tree?${q}`);
}

export function getBlob(id: string, ref: string, filePath: string) {
  const q = `ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(filePath)}`;
  return api<{ data: BlobResponse }>(`/projects/${id}/blob?${q}`);
}

export function getHistoryPage(id: string, limit: number, offset: number) {
  return api<{ data: HistoryPage }>(`/projects/${id}/history?limit=${limit}&offset=${offset}`);
}

export function getActivity(id: string, limit: number, offset: number) {
  return api<{ data: ActivityItem[] }>(`/projects/${id}/activity?limit=${limit}&offset=${offset}`);
}

// Direct browser link (goes through the /api proxy; session cookie follows).
export function archiveUrl(id: string, ref: string, format: string) {
  return `${API_BASE}/projects/${id}/archive?ref=${encodeURIComponent(ref)}&format=${format}`;
}
