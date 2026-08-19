// Paired test for constants/pull-requests.ts (named pull-requests.test.ts so repowise pairs it with the module; frontend parity lives in constants-sync.test.ts).: invariants of the PR statuses,
// merge methods and review states (parity with the frontend is enforced
// separately by constants-sync.test.ts).
import { describe, expect, it } from "bun:test";
import {
  PR_STATUSES,
  PR_STATUS_SLUGS,
  PR_TERMINAL_STATUSES,
  MERGE_METHODS,
  MERGE_METHOD_SLUGS,
  REVIEW_STATES,
  REVIEW_STATE_SLUGS,
} from "@/constants/pull-requests";

describe("pull request constants", () => {
  it("every status slug is unique and has a display name", () => {
    const slugs = PR_STATUS_SLUGS.map(String);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const entry of Object.values(PR_STATUSES)) {
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  it("terminal statuses are exactly the non-open statuses", () => {
    const nonOpen = PR_STATUS_SLUGS.filter((s) => s !== PR_STATUSES.OPEN.slug);
    expect([...PR_TERMINAL_STATUSES].sort()).toEqual([...nonOpen].sort());
  });

  it("merge methods and review states have unique slugs and names", () => {
    expect(new Set(MERGE_METHOD_SLUGS).size).toBe(MERGE_METHOD_SLUGS.length);
    expect(new Set(REVIEW_STATE_SLUGS).size).toBe(REVIEW_STATE_SLUGS.length);
    for (const entry of [...Object.values(MERGE_METHODS), ...Object.values(REVIEW_STATES)]) {
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });
});
