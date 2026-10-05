// Pure helpers to build copy-paste git setup snippets for a project page.
import { DEFAULT_BRANCH, GIT_REMOTE_NAME } from "./constants/paths";
// Kept DOM-free so they are unit-testable with vitest.

// Matches backend parsing in modules/lfs/index.ts (comma separated, trimmed).
export function parseLfsPatterns(patterns?: string | null): string[] {
  return (patterns ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

export function gitRemoteCommands(baseUrl: string, projectName: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `git remote add ${GIT_REMOTE_NAME} ${base}/projects/${projectName}.git\ngit push -u ${GIT_REMOTE_NAME} ${DEFAULT_BRANCH}`;
}

// The block below is pasted into a shell and the patterns come from a stored
// project field, so a value that is not a plain glob must never reach it:
// quoting alone does not contain a closing quote, a newline, `;`, `$( )`, a
// backtick or a history expansion. The server rejects such patterns as well
// (LFS_PATTERN_PATTERN in backend/src/constants/limits.ts); this is the second
// gate, for values that were stored before that check existed.
const SHELL_SAFE_LFS_PATTERN = /^[A-Za-z0-9*._/-][A-Za-z0-9 *._/-]*$/;

export function lfsCommands(patterns: string[]): string {
  const safe = patterns.filter((pattern) => SHELL_SAFE_LFS_PATTERN.test(pattern));
  const lines = ["git lfs install"];
  if (safe.length > 0) {
    lines.push(`git lfs track ${safe.map((p) => `"${p}"`).join(" ")}`);
  }
  return lines.join("\n");
}
