import { GIT_RECEIVE_PACK } from "@/constants/protocol";
// Path classification for the git/LFS protocol. The data lives in
// constants/scopes.ts and constants/permissions.ts (single source of truth);
// this module only maps request method+path -> action and re-exports helpers.
import {
  ACTION_SCOPE,
  LFS_OPERATIONS,
  scopeAllows,
  type LfsOperation,
  type TokenScope,
} from "@/constants/scopes";
import { GIT_ACTIONS, type GitAction } from "@/constants/permissions";

const LFS_BATCH_PATH = "/info/lfs/objects/batch";
const LFS_OBJECTS_PATH = "/info/lfs/objects/";

export function classifyAction(method: string, path: string): GitAction {
  if (path.includes(GIT_RECEIVE_PACK)) return GIT_ACTIONS.PUSH;
  if (path.includes(LFS_BATCH_PATH)) return GIT_ACTIONS.LFS_BATCH;
  if (path.includes(LFS_OBJECTS_PATH)) return method === "PUT" ? GIT_ACTIONS.LFS_UPLOAD : GIT_ACTIONS.LFS_DOWNLOAD;
  return GIT_ACTIONS.CLONE;
}

export function scopeForAction(action: GitAction): TokenScope {
  return ACTION_SCOPE[action];
}

export function scopeForLfsOperation(operation: LfsOperation): TokenScope {
  return operation === LFS_OPERATIONS.UPLOAD ? ACTION_SCOPE.lfsUpload : ACTION_SCOPE.lfsDownload;
}

export { scopeAllows };
