// Branch protection enforcement at PR merge time. Push-time rules are handled
// by the pre-receive hook; these checks run in the API where approvals and
// reviews live: required approvals, blocking on request-changes, merge user
// whitelist, and the admin bypass option. requiredApprovals is a
// second-principal requirement, which is why the reviews route refuses an
// approve or request-changes from the pull request author (isVotingReview).
// Pure DB logic, unit-testable.
import { eq } from "drizzle-orm";
import { db } from "@/config/db";
import { prReviews, users } from "@/db/schema/auth";
import { REVIEW_STATES } from "@/constants/pull-requests";
import { ADMIN_ROLE } from "@/constants/roles";
import {
  findProtectionRule,
  listProtectionRules,
} from "@/modules/projects/branch-protection";
import type { BranchProtectionRule } from "@/db/schema/auth";

// Result of checking a PR against the protection rules of its base branch.
export type MergeCheckResult =
  | { ok: true; rule: BranchProtectionRule | null }
  | { ok: false; reason: string; code: string };

// Review weights (approve +1, request_changes -1, comment 0). Pure so the
// scoring helpers stay unit-testable without a DB.
export const APPROVAL_WEIGHTS: Record<string, number> = {
  [REVIEW_STATES.APPROVE.slug]: 1,
  [REVIEW_STATES.REQUEST_CHANGES.slug]: -1,
  [REVIEW_STATES.COMMENT.slug]: 0,
};

export type ReviewLike = { state: string };

// Whether a review state carries a vote (approve / request changes). A comment
// weighs nothing. Derived from APPROVAL_WEIGHTS so the two cannot drift.
export function isVotingReview(state: string): boolean {
  return (APPROVAL_WEIGHTS[state] ?? 0) !== 0;
}

export function scoreReviews(reviews: ReviewLike[]): number {
  return reviews.reduce((sum, r) => sum + (APPROVAL_WEIGHTS[r.state] ?? 0), 0);
}

export function hasChangesRequested(reviews: ReviewLike[]): boolean {
  return scoreReviews(reviews) < 0;
}

type ReviewRow = { userId: string; createdAt: Date; state: string; headSha?: string | null };

// Effective votes: one per user, the latest submission wins. Reviews are
// append-only (every submission is a new row), so the latest row per user
// determines their current vote.
export function latestReviewsPerUser(rows: ReviewRow[]): ReviewRow[] {
  const latest = new Map<string, ReviewRow>();
  for (const r of rows) {
    const prev = latest.get(r.userId);
    if (!prev || r.createdAt > prev.createdAt) latest.set(r.userId, r);
  }
  return [...latest.values()];
}

// Sum of review weights for the PR. An approve followed by request_changes
// cancels the approval, and vice versa.
export async function reviewScore(prId: string): Promise<number> {
  const rows = await db
    .select({ userId: prReviews.userId, createdAt: prReviews.createdAt, state: prReviews.state })
    .from(prReviews)
    .where(eq(prReviews.prId, prId));
  return scoreReviews(latestReviewsPerUser(rows));
}

// Approvals that still speak about the revision under review. A review is a
// statement about the commit the reviewer read, so a vote cast against an
// earlier head is dismissed by the push that moved the branch: counting it
// would let an approved revision carry unreviewed commits into the merge. A row
// that names no revision counts for nothing (fail closed for older rows).
export function scoreReviewsForRevision(rows: ReviewRow[], headSha: string): number {
  return scoreReviews(latestReviewsPerUser(rows).filter((r) => r.headSha === headSha));
}

export async function approvalsForRevision(prId: string, headSha: string): Promise<number> {
  const rows = await db
    .select({ userId: prReviews.userId, createdAt: prReviews.createdAt, state: prReviews.state, headSha: prReviews.headSha })
    .from(prReviews)
    .where(eq(prReviews.prId, prId));
  return scoreReviewsForRevision(rows, headSha);
}

// Whether any outstanding review requests changes (weighted score < 0).
export async function hasOutstandingRequestChanges(prId: string): Promise<boolean> {
  const rows = await db
    .select({ userId: prReviews.userId, createdAt: prReviews.createdAt, state: prReviews.state })
    .from(prReviews)
    .where(eq(prReviews.prId, prId));
  return hasChangesRequested(latestReviewsPerUser(rows));
}

// Whether the user is allowed to merge a PR that is protected. Admin bypasses
// (either site-admin, or the rule's allowAdminBypass) when the whitelist is
// set; without a whitelist anyone with push may merge.
export async function canMergeUser(
  rule: BranchProtectionRule,
  userId: string
): Promise<boolean> {
  if (rule.restrictMergeUserIds && rule.restrictMergeUserIds.length > 0) {
    if (rule.restrictMergeUserIds.includes(userId)) return true;
    if (rule.allowAdminBypass) {
      const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { role: true } });
      if (user?.role === ADMIN_ROLE) return true;
    }
    return false;
  }
  return true;
}

// Checks the PR against the protection rule of its base branch. Returns ok
// when no rule applies or every gate passes.
export async function checkPrMergeAllowed(
  projectId: string,
  pr: { id: string; baseBranch: string },
  userId: string,
  headSha: string
): Promise<MergeCheckResult> {
  const rules = await listProtectionRules(projectId);
  const rule = findProtectionRule(rules, pr.baseBranch);
  if (!rule) return { ok: true, rule: null };

  if (rule.requiredApprovals > 0) {
    const score = await approvalsForRevision(pr.id, headSha);
    if (score < rule.requiredApprovals) {
      return {
        ok: false,
        code: "REQUIRED_APPROVALS",
        reason: `${rule.requiredApprovals} approval(s) required for the current revision; current score ${score}. Approvals cast against an earlier revision were dismissed by the push that changed it`,
      };
    }
  }
  if (rule.blockOnRequestChanges && (await hasOutstandingRequestChanges(pr.id))) {
    return { ok: false, code: "REQUEST_CHANGES", reason: "Requested changes must be addressed before merging" };
  }
  if (!(await canMergeUser(rule, userId))) {
    return { ok: false, code: "RESTRICTED_MERGE", reason: "You are not allowed to merge into this branch" };
  }
  return { ok: true, rule };
}

// Convenience for the route: returns the rule id (for audit) or throws a
// MergeBlockedError with a user-facing message.
export class MergeBlockedError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export async function assertPrMergeAllowed(
  projectId: string,
  pr: { id: string; baseBranch: string },
  userId: string,
  headSha: string
): Promise<void> {
  const res = await checkPrMergeAllowed(projectId, pr, userId, headSha);
  if (!res.ok) throw new MergeBlockedError(res.code, res.reason);
}
