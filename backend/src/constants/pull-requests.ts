// Pull request constants - single source of truth (Pralumex style).
// The frontend mirrors this file in lib/constants/pull-requests.ts and
// tests/constants-sync.test.ts enforces parity.

export const PR_STATUSES = {
  OPEN: { slug: "open", name: "Open" },
  MERGED: { slug: "merged", name: "Merged" },
  CLOSED: { slug: "closed", name: "Closed" },
  REJECTED: { slug: "rejected", name: "Rejected" },
} as const;

export type PrStatus = (typeof PR_STATUSES)[keyof typeof PR_STATUSES]["slug"];

export const PR_STATUS_SLUGS = Object.values(PR_STATUSES).map((s) => s.slug) as [PrStatus, ...PrStatus[]];

// Terminal statuses: no reopen (Gitea behavior). The replacement flow is a new
// PR from the same branch.
export const PR_TERMINAL_STATUSES: PrStatus[] = [PR_STATUSES.MERGED.slug, PR_STATUSES.CLOSED.slug, PR_STATUSES.REJECTED.slug];

export const MERGE_METHODS = {
  MERGE: { slug: "merge", name: "Merge commit" },
  SQUASH: { slug: "squash", name: "Squash" },
  FAST_FORWARD: { slug: "fast_forward", name: "Fast-forward" },
} as const;

export type MergeMethod = (typeof MERGE_METHODS)[keyof typeof MERGE_METHODS]["slug"];

export const MERGE_METHOD_SLUGS = Object.values(MERGE_METHODS).map((m) => m.slug) as [MergeMethod, ...MergeMethod[]];

export const REVIEW_STATES = {
  APPROVE: { slug: "approve", name: "Approve" },
  REQUEST_CHANGES: { slug: "request_changes", name: "Request changes" },
  COMMENT: { slug: "comment", name: "Comment" },
} as const;

export type ReviewState = (typeof REVIEW_STATES)[keyof typeof REVIEW_STATES]["slug"];

export const REVIEW_STATE_SLUGS = Object.values(REVIEW_STATES).map((r) => r.slug) as [ReviewState, ...ReviewState[]];
