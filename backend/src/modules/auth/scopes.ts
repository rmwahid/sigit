// Single source of truth untuk scope git/LFS.
// Semua pengecekan scope (middleware requireGitToken + route batch LFS) memakai
// mapping dan helper di sini - jangan menulis cek scope manual di tempat lain.
import type { TokenScope } from "./tokens";

export type GitAction = "clone" | "push" | "lfsDownload" | "lfsUpload" | "lfsBatch";

// Mapping aksi -> scope minimum yang dibutuhkan.
// Tambah aksi baru di sini + classifyAction di bawah.
const ACTION_SCOPE: Record<GitAction, TokenScope> = {
  clone: "read", // git-upload-pack (fetch/clone/pull)
  push: "write", // git-receive-pack
  lfsDownload: "read", // GET /info/lfs/objects/:oid
  lfsUpload: "write", // PUT /info/lfs/objects/:oid
  lfsBatch: "read", // POST /info/lfs/objects/batch (per-operation, lihat scopeForLfsOperation)
};

// Klasifikasi path git/LFS -> aksi. Dipakai middleware (body request belum dibaca,
// jadi operation batch belum diketahui di titik ini).
export function classifyAction(method: string, path: string): GitAction {
  if (path.includes("git-receive-pack")) return "push";
  if (path.includes("/info/lfs/objects/batch")) return "lfsBatch";
  if (path.includes("/info/lfs/objects/")) return method === "PUT" ? "lfsUpload" : "lfsDownload";
  return "clone";
}

export function scopeForAction(action: GitAction): TokenScope {
  return ACTION_SCOPE[action];
}

// Operasi batch LFS: "upload" butuh scope write, "download" cukup read.
export function scopeForLfsOperation(operation: "download" | "upload"): TokenScope {
  return operation === "upload" ? ACTION_SCOPE.lfsUpload : ACTION_SCOPE.lfsDownload;
}

// "write" otomatis termasuk "read" (push = clone/pull).
export function scopeAllows(tokenScope: TokenScope, required: TokenScope): boolean {
  return tokenScope === "write" || required === "read";
}
