import { DEFAULT_HISTORY_LIMIT, MAX_FILE_BROWSER_BYTES, DEFAULT_LFS_SIZE_THRESHOLD } from "@/constants/limits";
import { HOOK_MESSAGES } from "@/constants/lfs-messages";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

function repoCwd(repoPath: string) {
  return { cwd: repoPath };
}

// Run git WITHOUT a shell: refs and paths are argv, never interpolated strings.
export function execGit(repoPath: string, args: string[], maxBuffer = 32 * 1024 * 1024) {
  return execFileAsync("git", args, { cwd: repoPath, encoding: "buffer", maxBuffer });
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

// Pre-receive hook: reject blobs above the threshold (big files must go through LFS)
// and enforce branch protection rules. The threshold is baked in at install;
// protection rules are read from the _protection/<name>.snapshot file (written
// by the server on every rule change; hooks cannot reach the database).
export async function installPreReceiveHook(repoPath: string, threshold: number): Promise<void> {
  const script = `#!/bin/sh
# SiGit pre-receive hook: rejects large blobs that did not go through git-lfs,
# and enforces branch protection rules from the _protection/<name>.snapshot
# file (written by the server; hooks cannot reach the database).
THRESHOLD=${threshold}
# $0 is the hook script (repo/hooks/pre-receive). Normalize it to an absolute
# path first: git may invoke the hook with a relative $0, and basename of a
# relative dirname is not reliable. The snapshot lives next to the repo dir.
HOOK_DIR="\$(cd "\$(dirname "\$0")" && pwd)" || exit 1
REPO_DIR="\$(dirname "\$HOOK_DIR")"
PROTECTION_FILE="\$(dirname "\$REPO_DIR")/_protection/\$(basename "\$REPO_DIR").snapshot"
ZERO=0000000000000000000000000000000000000000
fail=0
tmp=\$(mktemp) || exit 1

# --- branch protection rule lookup -----------------------------------------
# The snapshot is key=value blocks, one rule per block, blank line separated
# (see rulesSnapshot in modules/projects/branch-protection.ts). The most
# specific matching pattern wins (exact > prefix length > "*"); fields of the
# winning rule end up in the RULE_* globals.
read_rule() {
  branch="\$1"
  best_score=-1
  RULE_PATTERN=""
  RULE_REQUIRE_PR="false"
  RULE_REQUIRED_APPROVALS="0"
  RULE_BLOCK_REQUEST="false"
  RULE_BLOCK_FORCE="false"
  RULE_BLOCK_DELETE="false"
  RULE_RESTRICT_PUSH=""
  RULE_ALLOW_BYPASS="false"
  pat=""
  require_pr="false"; required_approvals="0"; block_request="false"
  block_force="false"; block_delete="false"; restrict_push=""; allow_bypass="false"

  consider() {
    [ -n "\$pat" ] || return 0
    if [ "\$pat" = "\$branch" ]; then
      score=1000000
    elif [ "\$pat" = "*" ]; then
      score=0
    elif [ "\${pat%\\*}" != "\$pat" ]; then
      prefix=\${pat%\\*}
      case "\$branch" in
        "\$prefix"*) score=\${#pat} ;;
        *) score=-1 ;;
      esac
    else
      score=-1
    fi
    if [ "\$score" -gt "\$best_score" ]; then
      best_score=\$score
      RULE_PATTERN=\$pat
      RULE_REQUIRE_PR=\$require_pr
      RULE_REQUIRED_APPROVALS=\$required_approvals
      RULE_BLOCK_REQUEST=\$block_request
      RULE_BLOCK_FORCE=\$block_force
      RULE_BLOCK_DELETE=\$block_delete
      RULE_RESTRICT_PUSH=\$restrict_push
      RULE_ALLOW_BYPASS=\$allow_bypass
    fi
    pat=""
  }

  if [ -s "\$PROTECTION_FILE" ]; then
    while IFS= read -r line || [ -n "\$line" ]; do
      case "\$line" in
        "") consider ;;
        pattern=*) pat=\${line#pattern=} ;;
        requirePr=*) require_pr=\${line#requirePr=} ;;
        requiredApprovals=*) required_approvals=\${line#requiredApprovals=} ;;
        blockOnRequestChanges=*) block_request=\${line#blockOnRequestChanges=} ;;
        blockForcePush=*) block_force=\${line#blockForcePush=} ;;
        blockDeletion=*) block_delete=\${line#blockDeletion=} ;;
        restrictPushUserIds=*) restrict_push=\${line#restrictPushUserIds=} ;;
        allowAdminBypass=*) allow_bypass=\${line#allowAdminBypass=} ;;
      esac
    done < "\$PROTECTION_FILE"
    consider
  fi
}

# --- per-ref checks ---------------------------------------------------------
while read oldrev newrev ref; do
  branch=\${ref#refs/heads/}
  [ "\$branch" = "\$ref" ] && continue

  read_rule "\$branch"
  if [ -n "\$RULE_PATTERN" ]; then
    # block branch deletion (newrev zero)
    if [ "\$newrev" = "\$ZERO" ]; then
      if [ "\$RULE_BLOCK_DELETE" = "true" ]; then
        echo "Branch protection: deleting branch '\$branch' is not allowed" >&2
        fail=1
      fi
      continue
    fi
    # block force push (oldrev exists and is not an ancestor of newrev)
    if [ "\$oldrev" != "\$ZERO" ] && [ "\$RULE_BLOCK_FORCE" = "true" ]; then
      if ! git merge-base --is-ancestor "\$oldrev" "\$newrev" 2>/dev/null; then
        echo "Branch protection: force push to '\$branch' is not allowed" >&2
        fail=1
      fi
    fi
    # require pull requests: no direct pushes. Server-side merges (the PR
    # merge button pushes through a worktree) bypass this check - the API
    # already validated approvals and merge permissions.
    if [ "\$RULE_REQUIRE_PR" = "true" ] && [ "\${SIGIT_SERVER_PUSH:-}" != "1" ]; then
      echo "Branch protection: direct pushes to '\$branch' are not allowed; open a pull request" >&2
      fail=1
    fi
    # restrict push to a whitelist of user ids. GITPUSH_USER_ID is set by the
    # server from the authenticated token owner; server-side merges are gated
    # in the API (restrictMergeUserIds), so they bypass this check too.
    if [ -n "\$RULE_RESTRICT_PUSH" ] && [ "\${SIGIT_SERVER_PUSH:-}" != "1" ]; then
      case ",\$RULE_RESTRICT_PUSH," in
        *,"\${GITPUSH_USER_ID}",*) ;;
        *)
          echo "Branch protection: you are not allowed to push to '\$branch'" >&2
          fail=1
          ;;
      esac
    fi
  fi

  # LFS size check
  [ "\$newrev" = "\$ZERO" ] && continue
  if [ "\$oldrev" = "\$ZERO" ]; then
    git rev-list --objects "\$newrev" > "\$tmp" 2>/dev/null || continue
  else
    git rev-list --objects "\$newrev" --not "\$oldrev" > "\$tmp" 2>/dev/null || continue
  fi
  while IFS= read -r line; do
    sha=\${line%% *}
    path=\${line#* }
    type=\$(git cat-file -t "\$sha" 2>/dev/null)
    [ "\$type" != "blob" ] && continue
    size=\$(git cat-file -s "\$sha" 2>/dev/null)
    if [ "\$size" -gt "\$THRESHOLD" ]; then
      echo "${HOOK_MESSAGES.FILE_EXCEEDS_THRESHOLD}" >&2
      echo "${HOOK_MESSAGES.USE_LFS_TRACK}" >&2
      fail=1
    fi
  done < "\$tmp"
done
rm -f "\$tmp"
[ "\$fail" -ne 0 ] && exit 1
exit 0
`;
  const hookPath = path.join(repoPath, "hooks", "pre-receive");
  await fs.mkdir(path.dirname(hookPath), { recursive: true });
  await fs.writeFile(hookPath, script, { mode: 0o755 });
}

export async function getLog(repoPath: string, limit = DEFAULT_HISTORY_LIMIT, offset = 0, ref?: string): Promise<{ hash: string; date: string; message: string; author: string }[]> {
  const format = "%H%x1f%ai%x1f%s%x1f%an%x1e";
  const refArg = ref ? ` ${ref}` : "";
  const { stdout } = await execAsync(`git log --pretty=format:"${format}"${refArg} --skip ${offset} -n ${limit}`, repoCwd(repoPath));
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
  const range = a && b ? `${a}..${b}` : a ? await diffRangeForCommit(repoPath, a) : "HEAD";
  // execFile (no shell) matches execGit and avoids the cmd.exe spawn overhead
  // that makes every diff a few tens of ms slower on Windows.
  const { stdout } = await execFileAsync("git", ["diff", range], repoCwd(repoPath));
  return stdout;
}

// Empty tree hash: the diff baseline for root commits (they have no parent,
// so "hash~1" is an unknown revision and git fails hard).
const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

async function diffRangeForCommit(repoPath: string, hash: string): Promise<string> {
  try {
    await execAsync(`git rev-parse --verify "${hash}~1"`, repoCwd(repoPath));
    return `${hash}~1..${hash}`;
  } catch {
    return `${EMPTY_TREE_HASH}..${hash}`;
  }
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

// --- File browser helpers (git plumbing, argv-based, no shell) ---

// Refs and paths become git args (e.g. "HEAD:path"), so reject option-like or
// revision-syntax values even though the shell cannot interpret them.
export function isValidRefName(ref: string): boolean {
  if (!ref || ref.length > 200 || ref.startsWith("-") || ref.includes("..")) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref);
}

export function isValidFilePath(filePath: string): boolean {
  if (filePath.length > 500 || filePath.startsWith("/") || filePath.startsWith("-") || filePath.includes("..")) return false;
  return /^[A-Za-z0-9._/ -]*$/.test(filePath);
}

export type TreeEntry = {
  name: string;
  type: "blob" | "tree";
  mode: string;
  hash: string;
};

// git ls-tree -z <ref>:<dirPath> - entries split by NUL, meta/name by tab.
export async function listTree(repoPath: string, ref: string, dirPath = ""): Promise<TreeEntry[]> {
  const target = dirPath ? `${ref}:${dirPath}` : ref;
  const { stdout } = await execGit(repoPath, ["ls-tree", "-z", target]);
  return stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [meta, name] = line.split("\t");
      const [mode, type, hash] = meta.split(" ");
      return { name: name ?? "", type: type === "tree" ? "tree" : "blob", mode: mode ?? "", hash: hash ?? "" };
    });
}

export type ReadFileResult =
  | { ok: true; content: string; encoding: "text" | "base64"; size: number }
  | { ok: false; reason: "not-found" | "too-large" };

// Heuristic: NUL byte or a visible share of control bytes means binary content.
function looksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, 8192);
  if (sample.includes(0)) return true;
  let weird = 0;
  for (const byte of sample) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) weird++;
  }
  return weird > sample.length * 0.05;
}

export async function readFileAtRef(
  repoPath: string,
  ref: string,
  filePath: string,
  maxBytes = MAX_FILE_BROWSER_BYTES
): Promise<ReadFileResult> {
  const target = `${ref}:${filePath}`;
  let size = 0;
  try {
    const { stdout } = await execGit(repoPath, ["cat-file", "-s", target]);
    size = Number(stdout.toString("utf8").trim());
  } catch {
    return { ok: false, reason: "not-found" };
  }
  if (!Number.isFinite(size) || size > maxBytes) return { ok: false, reason: "too-large" };
  const { stdout } = await execGit(repoPath, ["cat-file", "blob", target]);
  const buf = Buffer.from(stdout);
  const binary = looksBinary(buf);
  return {
    ok: true,
    content: binary ? buf.toString("base64") : buf.toString("utf8"),
    encoding: binary ? "base64" : "text",
    size,
  };
}

export async function listBranches(repoPath: string): Promise<string[]> {
  const { stdout } = await execGit(repoPath, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  return stdout
    .toString("utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Full ref name of a branch (null when the branch does not exist).
export async function resolveBranchRef(repoPath: string, name: string): Promise<string | null> {
  try {
    const { stdout } = await execGit(repoPath, ["show-ref", "--verify", "--hash", `refs/heads/${name}`]);
    const sha = stdout.toString("utf8").trim();
    return sha || null;
  } catch {
    return null;
  }
}

// git child-process failures carry the real message in stderr (the Error
// message is only "Command failed: ..."). Routes classify errors with this.
export function gitErrorMessage(err: unknown): string {
  const e = err as { message?: string; stderr?: string | Buffer };
  const stderr = e?.stderr ? (typeof e.stderr === "string" ? e.stderr : e.stderr.toString("utf8")) : "";
  return (stderr || e?.message || String(err)).trim();
}

// Create a branch pointing at fromRef (default HEAD). Fails when the branch
// exists, the name is not a valid git ref name, or the repo has no commits.
export async function createBranch(repoPath: string, name: string, fromRef = "HEAD"): Promise<void> {
  // check-ref-format exits non-zero (stderr message) for invalid names.
  await execGit(repoPath, ["check-ref-format", "--branch", name]);
  const { stdout } = await execGit(repoPath, ["rev-parse", "--verify", `${fromRef}^{commit}`]);
  const sha = stdout.toString("utf8").trim();
  // Atomic create: the old value must be the all-zero hash (branch must not exist).
  await execGit(repoPath, ["update-ref", `refs/heads/${name}`, sha, "0000000000000000000000000000000000000000"]);
}

export async function deleteBranch(repoPath: string, name: string): Promise<void> {
  await execGit(repoPath, ["update-ref", "-d", `refs/heads/${name}`]);
}

// Short name of the branch HEAD points at ("main"), or null when unborn.
export async function resolveDefaultBranch(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execGit(repoPath, ["symbolic-ref", "--short", "HEAD"]);
    const name = stdout.toString("utf8").trim();
    return name || null;
  } catch {
    return null;
  }
}

export async function archive(repoPath: string, ref: string, format: string): Promise<Buffer> {
  const { stdout } = await execGit(repoPath, ["archive", `--format=${format}`, ref]);
  return Buffer.from(stdout);
}
