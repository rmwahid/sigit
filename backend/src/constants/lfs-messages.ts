// LFS error messages + git hook messages. Single source of truth (compared
// across module boundaries, e.g. routes/lfs.ts checks verify error strings).
export const LFS_MESSAGES = {
  OID_MISMATCH: "oid mismatch: sha256(content) != oid",
  OBJECT_DOES_NOT_EXIST: "object does not exist",
  SIZE_MISMATCH: "size mismatch: stored size != declared size",
} as const;

// Messages baked into the pre-receive hook script (modules/projects/git.ts).
// $path/$size/$THRESHOLD are shell variables inside the hook, not TS values.
export const HOOK_MESSAGES = {
  FILE_EXCEEDS_THRESHOLD: "SiGit: file '$path' ($size bytes) exceeds the $THRESHOLD bytes limit.",
  USE_LFS_TRACK: "SiGit: use 'git lfs track' for large files, or raise the project lfsSizeThreshold.",
} as const;
