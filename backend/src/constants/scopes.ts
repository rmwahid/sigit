// Token scopes and git/LFS action rules - single source of truth (Pralumex style).
// "write" implies "read" (push = clone/pull). The frontend mirrors this file in
// lib/constants/scopes.ts and tests/constants-sync.test.ts enforces parity.
import type { GitAction } from "./permissions";

export const TOKEN_SCOPES = {
  READ: { slug: "read", name: "Read" },
  WRITE: { slug: "write", name: "Read + Write" },
} as const;

export const TOKEN_SCOPE_SLUGS = Object.values(TOKEN_SCOPES).map((s) => s.slug) as [TokenScope, ...TokenScope[]];

export type TokenScope = (typeof TOKEN_SCOPES)[keyof typeof TOKEN_SCOPES]["slug"];

// LFS batch operations.
export const LFS_OPERATIONS = {
  DOWNLOAD: "download",
  UPLOAD: "upload",
} as const;

export type LfsOperation = (typeof LFS_OPERATIONS)[keyof typeof LFS_OPERATIONS];

// Minimum required token scope per git/LFS action (values reference TOKEN_SCOPES).
export const ACTION_SCOPE: Record<GitAction, TokenScope> = {
  clone: TOKEN_SCOPES.READ.slug, // git-upload-pack (fetch/clone/pull)
  push: TOKEN_SCOPES.WRITE.slug, // git-receive-pack
  lfsDownload: TOKEN_SCOPES.READ.slug, // GET /info/lfs/objects/:oid
  lfsUpload: TOKEN_SCOPES.WRITE.slug, // PUT /info/lfs/objects/:oid
  lfsBatch: TOKEN_SCOPES.READ.slug, // per operation, see scopeForLfsOperation
};

// "write" automatically includes "read" (push = clone/pull).
export function scopeAllows(tokenScope: TokenScope, required: TokenScope): boolean {
  return tokenScope === TOKEN_SCOPES.WRITE.slug || required === TOKEN_SCOPES.READ.slug;
}
