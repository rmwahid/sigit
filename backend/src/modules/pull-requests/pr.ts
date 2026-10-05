// Pure pull request helpers: git validation + diff. No DB access here, so the
// module stays unit-testable (like modules/lfs/server.ts); the route layer
// handles permissions, numbering, and persistence.
import { execGit, getDiff } from "@/modules/projects/git";
import { MAX_DIFF_BYTES } from "@/constants/limits";

export type PrGitValidation = {
  ok: boolean;
  error?: string;
};

// Ref names must exist in the repo. base === head is rejected (a PR needs two
// distinct branches); merge-base existence keeps PRs meaningful (the branches
// must have diverged at some point). Both fields are resolved through
// resolveRef, which is an exact ref lookup: a value like `main~1` or `main^{}`
// is not a branch here, it is a different revision than the one it names.
export async function validatePrBranches(repoPath: string, base: string, head: string): Promise<PrGitValidation> {
  if (base === head) {
    return { ok: false, error: "Base and head branch must be different" };
  }
  for (const ref of [base, head]) {
    try {
      await resolveRef(repoPath, ref);
    } catch {
      return { ok: false, error: `Branch "${ref}" does not exist` };
    }
  }
  try {
    await execGit(repoPath, ["merge-base", "refs/heads/" + base, "refs/heads/" + head]);
  } catch {
    return { ok: false, error: "Branches have no common merge base" };
  }
  return { ok: true };
}

// Diff for the PR preview. Two modes:
// - Branch mode (open PRs): the three-dot range `base...head` diffs against
//   the merge base in a single git process, so new base commits do not leak
//   into the preview and no separate merge-base lookup is needed.
// - Commit mode (merged PRs, pass a single commit sha): diff of the merge
//   commit itself (parent..commit). The base branch contains the head after a
//   merge, so a branch range would come back empty; the stored merge commit
//   is the exact source of truth for what this PR brought in.
export async function prDiff(
  repoPath: string,
  base: string,
  head?: string,
  maxBytes = MAX_DIFF_BYTES
): Promise<string> {
  if (head === undefined) {
    return getDiff(repoPath, `${base}~1`, base, maxBytes);
  }
  try {
    const { stdout } = await execGit(repoPath, ["diff", `refs/heads/${base}...refs/heads/${head}`], maxBytes);
    return stdout.toString("utf8");
  } catch (err) {
    // Same bargain as getDiff: a diff past the cap comes back truncated and
    // marked rather than failing the request.
    const partial = (err as { stdout?: Buffer | string }).stdout;
    if (partial && /maxBuffer/i.test(String((err as Error).message))) {
      return `${Buffer.from(partial).toString("utf8")}\n\n[diff truncated at ${maxBytes} bytes]\n`;
    }
    throw err;
  }
}

// Resolves a branch name to the commit it points at (or throws when missing).
// show-ref resolves the ref itself rather than a revision: `rev-parse --verify`
// would also accept the revision operators (~, ^, {}) and dash-prefixed values
// under refs/heads/, so a stored field could name one branch and act on another.
export async function resolveRef(repoPath: string, ref: string): Promise<string> {
  const { stdout } = await execGit(repoPath, ["show-ref", "--verify", "--hash", `refs/heads/${ref}`]);
  return stdout.toString("utf8").trim();
}
