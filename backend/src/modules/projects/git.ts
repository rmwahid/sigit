import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { DEFAULT_LFS_SIZE_THRESHOLD } from "../../db/schema/projects";

const execAsync = promisify(exec);

function repoCwd(repoPath: string) {
  return { cwd: repoPath };
}

export async function initRepo(repoPath: string, lfsThreshold = DEFAULT_LFS_SIZE_THRESHOLD): Promise<void> {
  await fs.mkdir(repoPath, { recursive: true });
  try {
    await execAsync("git init --bare -b main", repoCwd(repoPath));
    await execAsync("git config user.email \"sigit@local\"", repoCwd(repoPath));
    await execAsync("git config user.name \"SiGit\"", repoCwd(repoPath));
  } catch {
    // may already be initialized
  }
  await installPreReceiveHook(repoPath, lfsThreshold);
}

// Pre-receive hook: reject blobs above the threshold (big files must go through LFS).
// The threshold is baked into the script at install; regenerated when the project is updated.
export async function installPreReceiveHook(repoPath: string, threshold: number): Promise<void> {
  const script = `#!/bin/sh
# SiGit pre-receive hook: rejects large blobs that did not go through git-lfs.
# Large files never enter the server history (server stays small).
THRESHOLD=${threshold}
fail=0
tmp=$(mktemp) || exit 1
while read oldrev newrev ref; do
  [ "$newrev" = "0000000000000000000000000000000000000000" ] && continue
  if [ "$oldrev" = "0000000000000000000000000000000000000000" ]; then
    git rev-list --objects "$newrev" > "$tmp" 2>/dev/null || continue
  else
    git rev-list --objects "$newrev" --not "$oldrev" > "$tmp" 2>/dev/null || continue
  fi
  while IFS= read -r line; do
    sha=\${line%% *}
    path=\${line#* }
    type=$(git cat-file -t "$sha" 2>/dev/null)
    [ "$type" != "blob" ] && continue
    size=$(git cat-file -s "$sha" 2>/dev/null)
    if [ "$size" -gt "$THRESHOLD" ]; then
      echo "SiGit: file '$path' ($size bytes) exceeds the $THRESHOLD bytes limit." >&2
      echo "SiGit: use 'git lfs track' for large files, or raise the project lfsSizeThreshold." >&2
      fail=1
    fi
  done < "$tmp"
done
rm -f "$tmp"
[ "$fail" -ne 0 ] && exit 1
exit 0
`;
  const hookPath = path.join(repoPath, "hooks", "pre-receive");
  await fs.mkdir(path.dirname(hookPath), { recursive: true });
  await fs.writeFile(hookPath, script, { mode: 0o755 });
}

export async function getLog(repoPath: string, limit = 50): Promise<{ hash: string; date: string; message: string; author: string }[]> {
  const format = "%H%x1f%ai%x1f%s%x1f%an%x1e";
  const { stdout } = await execAsync(`git log --pretty=format:"${format}" -n ${limit}`, repoCwd(repoPath));
  if (!stdout.trim()) return [];
  return stdout
    .split("\x1e")
    .filter(Boolean)
    .map((entry) => {
      const [hash, date, message, author] = entry.split("\x1f");
      return { hash: hash.trim(), date: date.trim(), message: message.trim(), author: author.trim() };
    });
}

export async function getDiff(repoPath: string, a?: string, b?: string): Promise<string> {
  const range = a && b ? `${a}..${b}` : a ? `${a}~1..${a}` : "HEAD";
  const { stdout } = await execAsync(`git diff ${range}`, repoCwd(repoPath));
  return stdout;
}

export async function getCommitFiles(repoPath: string, hash: string): Promise<{ path: string; status: string }[]> {
  // git show (not diff-tree): diff-tree returns empty on bare repos with some
  // Windows git versions; the output format is the same (status\tpath).
  const { stdout } = await execAsync(`git show --format= --name-status ${hash}`, repoCwd(repoPath));
  if (!stdout.trim()) return [];
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, filePath] = line.split("\t");
      return { path: filePath, status: status ?? "?" };
    });
}

export async function resolveHead(repoPath: string): Promise<string | null> {
  try {
    // --verify fails (exit != 0) on a repo without commits (unborn HEAD),
    // whereas `git rev-parse HEAD` in newer git returns the string "HEAD".
    const { stdout } = await execAsync("git rev-parse --verify HEAD", repoCwd(repoPath));
    return stdout.trim();
  } catch {
    return null;
  }
}
