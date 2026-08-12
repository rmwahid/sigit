// Single source of truth for git/LFS scopes.
// All scope checks (requireGitToken middleware + LFS batch route) use the
// mapping and helpers here - do not write manual scope checks elsewhere.
import type { TokenScope } from "./tokens";

export type GitAction = "clone" | "push" | "lfsDownload" | "lfsUpload" | "lfsBatch";

// Map of action -> minimum required scope.
// Add new actions here and in classifyAction below.
const ACTION_SCOPE: Record<GitAction, TokenScope> = {
  clone: "read", // git-upload-pack (fetch/clone/pull)
  push: "write", // git-receive-pack
  lfsDownload: "read", // GET /info/lfs/objects/:oid
  lfsUpload: "write", // PUT /info/lfs/objects/:oid
  lfsBatch: "read", // POST /info/lfs/objects/batch (per operation, see scopeForLfsOperation)
};

// Classify a git/LFS path -> action. Used by the middleware (the request body
// is not read yet, so the batch operation is unknown at this point).
export function classifyAction(method: string, path: string): GitAction {
  if (path.includes("git-receive-pack")) return "push";
  if (path.includes("/info/lfs/objects/batch")) return "lfsBatch";
  if (path.includes("/info/lfs/objects/")) return method === "PUT" ? "lfsUpload" : "lfsDownload";
  return "clone";
}

export function scopeForAction(action: GitAction): TokenScope {
  return ACTION_SCOPE[action];
}

// LFS batch operation: "upload" needs write scope, "download" needs read only.
export function scopeForLfsOperation(operation: "download" | "upload"): TokenScope {
  return operation === "upload" ? ACTION_SCOPE.lfsUpload : ACTION_SCOPE.lfsDownload;
}

// "write" automatically includes "read" (push = clone/pull).
export function scopeAllows(tokenScope: TokenScope, required: TokenScope): boolean {
  return tokenScope === "write" || required === "read";
}
