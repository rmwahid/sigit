// Pure pull request helpers: git validation + diff. No DB access here, so the
// module stays unit-testable (like modules/lfs/server.ts); the route layer
// handles permissions, numbering, and persistence.
import { execGit, getDiff } from "@/modules/projects/git";

export type PrGitValidation = {
  ok: boolean;
  error?: string;
};

// Ref names must exist in the repo. base === head is rejected (a PR needs two
// distinct branches); merge-base existence keeps PRs meaningful (the branches
// must have diverged at some point).
export async function validatePrBranches(repoPath: string, base: string, head: string): Promise<PrGitValidation> {
  if (base === head) {
    return { ok: false, error: "Base and head branch must be different" };
  }
  for (const ref of [base, head]) {
    try {
      await execGit(repoPath, ["rev-parse", "--verify", `refs/heads/${ref}^{commit}`]);
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

// Unified diff between two refs (for the PR diff preview). Empty string when
// the refs are identical (getDiff contract: returns "" when a === b).
export async function prDiff(repoPath: string, base: string, head: string): Promise<string> {
  return getDiff(repoPath, `refs/heads/${base}`, `refs/heads/${head}`);
}

// Resolves a branch name to its commit sha (or throws when missing).
export async function resolveRef(repoPath: string, ref: string): Promise<string> {
  const { stdout } = await execGit(repoPath, ["rev-parse", "--verify", `refs/heads/${ref}^{commit}`]);
  return stdout.toString("utf8").trim();
}
