// Paired test for modules/pull-requests/protection.ts: review scoring and
// merge-gate rules. The full merge-gate flow (approvals blocking the merge
// endpoint) is covered in tests/pull-requests.test.ts; here the pure helpers
// are tested directly.
import { describe, expect, it } from "bun:test";
import {
  APPROVAL_WEIGHTS,
  scoreReviews,
  hasChangesRequested,
  latestReviewsPerUser,
  scoreReviewsForRevision,
} from "@/modules/pull-requests/protection";

describe("protection review scoring", () => {
  it("weighs approve +1, request_changes -1, comment 0", () => {
    expect(APPROVAL_WEIGHTS).toEqual({ approve: 1, request_changes: -1, comment: 0 });
  });

  it("sums the weights of the effective votes", () => {
    expect(scoreReviews([{ state: "approve" }, { state: "approve" }, { state: "comment" }])).toBe(2);
    expect(scoreReviews([{ state: "approve" }, { state: "request_changes" }])).toBe(0);
    expect(scoreReviews([])).toBe(0);
  });

  it("detects outstanding request-changes (negative score)", () => {
    expect(hasChangesRequested([{ state: "request_changes" }])).toBe(true);
    expect(hasChangesRequested([{ state: "request_changes" }, { state: "request_changes" }])).toBe(true);
    expect(hasChangesRequested([{ state: "approve" }])).toBe(false);
    expect(hasChangesRequested([{ state: "approve" }, { state: "request_changes" }])).toBe(false); // 0, not negative
    expect(hasChangesRequested([])).toBe(false);
  });
});

describe("latestReviewsPerUser", () => {
  const row = (userId: string, createdAt: Date, state: string) => ({ userId, createdAt, state });

  it("keeps only the latest row per user (append-only reviews)", () => {
    const rows = [
      row("u1", new Date("2026-01-01T00:00:00Z"), "approve"),
      row("u1", new Date("2026-01-02T00:00:00Z"), "request_changes"),
      row("u2", new Date("2026-01-03T00:00:00Z"), "approve"),
    ];
    const latest = latestReviewsPerUser(rows);
    expect(latest).toHaveLength(2);
    expect(latest.find((r) => r.userId === "u1")?.state).toBe("request_changes");
    expect(latest.find((r) => r.userId === "u2")?.state).toBe("approve");
  });

  it("treats same-timestamp rows by insertion order (first wins)", () => {
    const t = new Date("2026-01-01T00:00:00Z");
    const rows = [row("u1", t, "approve"), row("u1", t, "request_changes")];
    expect(latestReviewsPerUser(rows)[0].state).toBe("approve");
  });

  it("returns an empty list for no rows", () => {
    expect(latestReviewsPerUser([])).toEqual([]);
  });
});

describe("scoreReviewsForRevision", () => {
  const at = new Date("2026-01-01T00:00:00Z");
  const vote = (userId: string, state: string, headSha: string | null) => ({ userId, createdAt: at, state, headSha });

  it("counts only approvals cast against the revision under review", () => {
    const rows = [vote("u1", "approve", "rev-a"), vote("u2", "approve", "rev-b")];
    expect(scoreReviewsForRevision(rows, "rev-a")).toBe(1);
    expect(scoreReviewsForRevision(rows, "rev-b")).toBe(1);
    // A revision nobody approved scores zero: the push that produced it
    // dismissed the approvals the merge gate used to count.
    expect(scoreReviewsForRevision(rows, "rev-c")).toBe(0);
  });

  it("counts a review that names no revision for nothing", () => {
    expect(scoreReviewsForRevision([vote("u1", "approve", null)], "rev-a")).toBe(0);
  });

  it("keeps the latest vote per user within one revision", () => {
    const rows = [
      { userId: "u1", createdAt: at, state: "approve", headSha: "rev-a" },
      { userId: "u1", createdAt: new Date(at.getTime() + 60_000), state: "request_changes", headSha: "rev-a" },
      { userId: "u2", createdAt: at, state: "approve", headSha: "rev-a" },
    ];
    expect(scoreReviewsForRevision(rows, "rev-a")).toBe(0);
  });
});
