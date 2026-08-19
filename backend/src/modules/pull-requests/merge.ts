// PR merge via git worktree. The bare repo is never checked out; a temporary
// worktree (under SIGIT_PROJECTS_ROOT/_worktrees) holds the base branch while
// the head branch is merged into it, then the result is pushed back to the
// bare repo (updating refs/heads/<base>). The pre-receive hook runs on the
// bare repo during that push, so size limits still apply.
import { execGit } from "@/modules/projects/git";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "@/config/env";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/config/db";
import { pullRequests } from "@/db/schema/auth";
import { PR_STATUSES } from "@/constants/pull-requests";

const WORKTREES_ROOT = path.resolve(env.SIGIT_PROJECTS_ROOT, "_worktrees");

export type MergeMethod = "merge" | "squash" | "fast_forward";

export type MergeResult =
  | { ok: true; mergeCommitSha: string; method: MergeMethod }
  | { ok: false; error: string; conflict?: boolean };

// Whether a trial merge (no commit, no ref update) of head into base succeeds.
export type MergeableStatus = "unknown" | "mergeable" | "conflict";

function gitIdentityArgs(): string[] {
  return ["-c", "user.name=SiGit", "-c", "user.email=sigit@local"];
}

async function worktreePath(): Promise<string> {
  await fs.mkdir(WORKTREES_ROOT, { recursive: true });
  return path.join(WORKTREES_ROOT, `pr-${randomUUID()}`);
}

async function cleanupWorktree(dir: string): Promise<void> {
  try {
    await execGit(dir, ["worktree", "remove", "--force", dir]);
  } catch {
    // worktree may already be gone; the dir itself is removed below
  }
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

// Runs fn inside a fresh detached worktree of the bare repo and always
// removes the worktree afterwards. The worktree metadata is unregistered via
// `worktree remove` (not just the directory) so the bare repo does not leak
// worktree entries.
async function withWorktree<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await worktreePath();
  try {
    return await fn(dir);
  } finally {
    await cleanupWorktree(dir);
  }
}

// Registers the worktree in the bare repo, checks out the base branch, and
// merges head into it. Returns the resulting commit sha.
export async function mergePullRequest(
  barePath: string,
  base: string,
  head: string,
  method: MergeMethod
): Promise<MergeResult> {
  try {
    return await withWorktree(async (dir) => {
      await execGit(barePath, ["worktree", "add", "--detach", dir, `refs/heads/${base}`]);
      await execGit(dir, ["checkout", "-B", base, `refs/heads/${base}`]);
      // Fast-forward is the only method that does not create a commit: it just
      // moves the base ref, so detect conflicts by asking git whether the head
      // is an ancestor of the base (if so, no new commits to bring in).
      if (method === "fast_forward") {
        try {
          await execGit(dir, ["merge", "--ff-only", `refs/heads/${head}`]);
        } catch (err) {
          return { ok: false, error: gitMergeMessage(err), conflict: true };
        }
      } else {
        try {
          if (method === "squash") {
            await execGit(dir, ["merge", "--squash", `refs/heads/${head}`]);
            await execGit(dir, [...gitIdentityArgs(), "commit", "-m", `Merge pull request: ${head} (squash)`]);
          } else {
            await execGit(dir, [...gitIdentityArgs(), "merge", "--no-ff", "--no-edit", `refs/heads/${head}`]);
          }
        } catch (err) {
          return { ok: false, error: gitMergeMessage(err), conflict: true };
        }
      }
      const { stdout } = await execGit(dir, ["rev-parse", "HEAD"]);
      const mergeCommitSha = stdout.toString("utf8").trim();
      // Push back to the bare repo (this is what updates refs/heads/<base>).
      await execGit(dir, ["push", barePath, `HEAD:refs/heads/${base}`]);
      return { ok: true, mergeCommitSha, method };
    });
  } catch (err) {
    return { ok: false, error: gitMergeMessage(err) };
  }
}

// Trial merge that writes nothing: no commit, no ref update. The merge mode
// mirrors the real "merge" method (3-way), so its result matches what the
// merge button would do. A merge that is not a fast-forward is still
// "mergeable" unless git reports conflicts.
export async function checkMergeable(barePath: string, base: string, head: string): Promise<MergeableStatus> {
  try {
    return await withWorktree(async (dir) => {
      await execGit(barePath, ["worktree", "add", "--detach", dir, `refs/heads/${base}`]);
      try {
        await execGit(dir, ["merge", "--no-commit", "--no-ff", `refs/heads/${head}`]);
        return "mergeable";
      } catch (err) {
        // A missing head ref is not a conflict: there is simply nothing to
        // merge yet, so report it as unknown instead of a red badge.
        if (/not something we can merge|unknown revision|bad revision/i.test(gitMergeMessage(err))) {
          return "unknown";
        }
        return "conflict";
      } finally {
        // Roll back any partial merge state so the worktree is clean.
        await execGit(dir, ["merge", "--abort"]).catch(() => {});
      }
    });
  } catch (err) {
    // Branch missing or other repo-level failure: nothing to report yet.
    return "unknown";
  }
}

// Recomputes the trial-merge status for every open PR of a project. Called
// after a push that may have moved the base or head branch, and after PR
// creation/reopen. Errors are swallowed: the stored status only degrades to
// "unknown", never fails the request that triggered the refresh.
export async function refreshOpenPrMergeability(projectId: string, barePath: string): Promise<void> {
  try {
    const rows = await db
      .select({ id: pullRequests.id, baseBranch: pullRequests.baseBranch, headBranch: pullRequests.headBranch })
      .from(pullRequests)
      .where(and(eq(pullRequests.projectId, projectId), eq(pullRequests.status, PR_STATUSES.OPEN.slug)));
    for (const pr of rows) {
      const status = await checkMergeable(barePath, pr.baseBranch, pr.headBranch);
      await db.update(pullRequests).set({ mergeableStatus: status }).where(eq(pullRequests.id, pr.id));
    }
  } catch {
    // Database or repo unavailable: leave stored statuses untouched.
  }
}

// Human-readable failure message from a git child process (stderr wins).
function gitMergeMessage(err: unknown): string {
  const e = err as { message?: string; stderr?: string | Buffer };
  const stderr = e?.stderr ? (typeof e.stderr === "string" ? e.stderr : e.stderr.toString("utf8")) : "";
  return (stderr || e?.message || String(err)).trim();
}
