import { describe, expect, it } from "vitest";
import {
  defaultRef,
  deriveTabKeys,
  emptyRichText,
  formatActivityItem,
  groupActivityByDate,
  hasProjectPerm,
  isValidBranchName,
  joinPath,
  prMergeableBadgeClass,
  prMergeableLabel,
  prStatusBadgeClass,
  prStatusLabel,
  reviewActionLabel,
  isPlainPrComment,
  sortEntries,
  splitPath,
} from "$lib/project-page";

describe("joinPath / splitPath", () => {
  it("joins and splits directory paths", () => {
    expect(joinPath("", "src")).toBe("src");
    expect(joinPath("src", "lib")).toBe("src/lib");
    expect(splitPath("")).toEqual([]);
    expect(splitPath("src/lib")).toEqual(["src", "lib"]);
  });
});

describe("hasProjectPerm", () => {
  it("admin (null access) has everything", () => {
    expect(hasProjectPerm(null, false, "view")).toBe(true);
    expect(hasProjectPerm(null, false, "history")).toBe(true);
    expect(hasProjectPerm(null, false, "push")).toBe(true);
  });

  it("collaborators are limited to their granted set", () => {
    expect(hasProjectPerm(["view"], false, "view")).toBe(true);
    expect(hasProjectPerm(["view"], false, "history")).toBe(false);
    expect(hasProjectPerm([], false, "view")).toBe(false);
  });

  it("anonymous public visitors get view + history only", () => {
    expect(hasProjectPerm(null, true, "view")).toBe(true);
    expect(hasProjectPerm(null, true, "history")).toBe(true);
    expect(hasProjectPerm(null, true, "push")).toBe(false);
  });
});

describe("deriveTabKeys", () => {
  it("admin sees all five tabs", () => {
    expect(deriveTabKeys(null, false)).toEqual(["code", "history", "pull-requests", "activity", "settings"]);
  });

  it("collaborator with history sees code/history/activity", () => {
    expect(deriveTabKeys(["view", "history"], false)).toEqual(["code", "history", "activity"]);
  });

  it("collaborator with diff permission gets the pull requests tab", () => {
    expect(deriveTabKeys(["view", "history", "diff"], false)).toEqual(["code", "history", "pull-requests", "activity"]);
  });

  it("collaborator without history sees code only", () => {
    expect(deriveTabKeys(["view"], false)).toEqual(["code"]);
  });

  it("anonymous sees code + history (no activity, no PR, no settings)", () => {
    expect(deriveTabKeys(null, true)).toEqual(["code", "history"]);
  });
});

describe("formatActivityItem", () => {
  it("renders commits as author + message", () => {
    expect(formatActivityItem({ type: "commit", ts: "2026-08-20T10:00:00Z", author: "dev", message: "feat: x", hash: "abc" })).toBe(
      "dev committed feat: x"
    );
  });

  it("renders pull request events with number and actor", () => {
    expect(
      formatActivityItem({ type: "event", ts: "t", event: "pull_request.create", prNumber: 3, baseBranch: "main", headBranch: "feature/x", by: "admin@sigit.dev" })
    ).toBe("Opened pull request #3 (feature/x -> main) by admin@sigit.dev");
    expect(
      formatActivityItem({ type: "event", ts: "t", event: "pull_request.status_change", prNumber: 4, from: "open", to: "rejected", by: "admin@sigit.dev" })
    ).toBe("Changed status of pull request #4 to Rejected by admin@sigit.dev");
    expect(
      formatActivityItem({ type: "event", ts: "t", event: "pull_request.status_change", prNumber: 4, from: "open", to: "abandoned", by: "admin@sigit.dev" })
    ).toBe("Changed status of pull request #4 to Abandoned by admin@sigit.dev");
    expect(
      formatActivityItem({ type: "event", ts: "t", event: "pull_request.update", prNumber: 4, fields: ["title"], by: "admin@sigit.dev" })
    ).toBe("Updated pull request #4 (title) by admin@sigit.dev");
    expect(
      formatActivityItem({ type: "event", ts: "t", event: "pull_request.merge", prNumber: 2, method: "squash", mergeCommitSha: "3a9f2c1abc", by: "admin@sigit.dev" })
    ).toBe("Merged pull request #2 (squash, 3a9f2c1) by admin@sigit.dev");
    expect(
      formatActivityItem({ type: "event", ts: "t", event: "pull_request.review", prNumber: 1, state: "approve", by: "dev@sigit.dev" })
    ).toBe("Approved pull request #1 by dev@sigit.dev");
    expect(
      formatActivityItem({ type: "event", ts: "t", event: "pull_request.review", prNumber: 1, state: "request_changes", by: "dev@sigit.dev" })
    ).toBe("Requested changes on pull request #1 by dev@sigit.dev");
  });

  it("renders branch and push events with their details", () => {
    expect(formatActivityItem({ type: "event", ts: "t", event: "branch.create", branch: "feature/x", by: "admin" })).toBe(
      "Created branch feature/x by admin"
    );
    expect(formatActivityItem({ type: "event", ts: "t", event: "git.push", ref: "main", by: "dev" })).toBe("Pushed to main by dev");
  });

  it("falls back to the raw event name for unknown events", () => {
    expect(formatActivityItem({ type: "event", ts: "t", event: "some.new_event" })).toBe("some.new_event");
  });
});

describe("sortEntries", () => {
  it("puts directories first, then alphabetical", () => {
    const sorted = sortEntries([
      { name: "b.txt", type: "blob", mode: "100644", hash: "b" },
      { name: "src", type: "tree", mode: "040000", hash: "s" },
      { name: "a.txt", type: "blob", mode: "100644", hash: "a" },
    ]);
    expect(sorted.map((e) => e.name)).toEqual(["src", "a.txt", "b.txt"]);
  });
});

describe("groupActivityByDate", () => {
  it("groups by ISO date prefix in insertion order", () => {
    const groups = groupActivityByDate([
      { type: "commit", ts: "2026-08-14T01:00:00Z" },
      { type: "event", ts: "2026-08-14T02:00:00Z" },
      { type: "commit", ts: "2026-08-13T03:00:00Z" },
    ]);
    expect(groups.map(([date]) => date)).toEqual(["2026-08-14", "2026-08-13"]);
    expect(groups[0][1].length).toBe(2);
    expect(groups[1][1].length).toBe(1);
  });
});

describe("defaultRef", () => {
  it("prefers the default branch, then the first branch, then HEAD", () => {
    expect(defaultRef("main", ["main", "dev"])).toBe("main");
    expect(defaultRef(null, ["dev"])).toBe("dev");
    expect(defaultRef(null, [])).toBe("HEAD");
  });
});

describe("emptyRichText", () => {
  it("treats empty and whitespace-only HTML as empty", () => {
    expect(emptyRichText("")).toBe(true);
    expect(emptyRichText("<p></p>")).toBe(true);
    expect(emptyRichText("<p><br></p><ul></ul>")).toBe(true);
    expect(emptyRichText("<p>   </p>")).toBe(true);
  });

  it("treats content-bearing HTML as non-empty", () => {
    expect(emptyRichText("<p>Hello</p>")).toBe(false);
    expect(emptyRichText("<p><strong>Hi</strong></p>")).toBe(false);
    expect(emptyRichText("<ul><li>item</li></ul>")).toBe(false);
    expect(emptyRichText("<p>a<br>b</p>")).toBe(false);
  });
});

describe("isValidBranchName", () => {
  it("accepts names with letters, numbers, . _ - /", () => {
    expect(isValidBranchName("main")).toBe(true);
    expect(isValidBranchName("feature/x")).toBe(true);
    expect(isValidBranchName("release-2.0_rc")).toBe(true);
    expect(isValidBranchName("trailing-")).toBe(true);
  });

  it("rejects invalid branch names", () => {
    expect(isValidBranchName("")).toBe(false);
    expect(isValidBranchName("bad name!")).toBe(false);
    expect(isValidBranchName("-leading")).toBe(false);
    expect(isValidBranchName("a..b")).toBe(false);
    expect(isValidBranchName("x".repeat(201))).toBe(false);
  });
});

describe("PR badge helpers", () => {
  it("resolves every status slug to its constant name", () => {
    expect(prStatusLabel("open")).toBe("Open");
    expect(prStatusLabel("merged")).toBe("Merged");
    expect(prStatusLabel("abandoned")).toBe("Abandoned");
    expect(prStatusLabel("rejected")).toBe("Rejected");
  });

  it("colors merged green, abandoned purple, rejected red, open neutral", () => {
    expect(prStatusBadgeClass("merged")).toBe("border-success bg-success text-success-foreground");
    expect(prStatusBadgeClass("abandoned")).toBe("border-vivid bg-vivid text-vivid-foreground");
    expect(prStatusBadgeClass("rejected")).toBe("border-destructive bg-destructive text-destructive-foreground");
    expect(prStatusBadgeClass("open")).toBe("border-border bg-muted");
  });

  it("labels mergeability from the constants map", () => {
    expect(prMergeableLabel("mergeable")).toBe("Mergeable");
    expect(prMergeableLabel("conflict")).toBe("Conflict");
    expect(prMergeableLabel("unknown")).toBe("Unknown");
  });

  it("styles mergeable green and conflict red", () => {
    expect(prMergeableBadgeClass("mergeable")).toBe("border-border bg-accent text-accent-foreground");
    expect(prMergeableBadgeClass("conflict")).toBe("border-destructive/40 bg-destructive/10 text-destructive");
    expect(prMergeableBadgeClass("unknown")).toBe("border-border bg-muted text-muted-foreground");
  });
});

describe("reviewActionLabel", () => {
  it("maps review states to activity sentences", () => {
    expect(reviewActionLabel("approve")).toBe("Approved");
    expect(reviewActionLabel("request_changes")).toBe("Requested changes on");
    expect(reviewActionLabel("comment")).toBe("Reviewed");
  });
});

describe("isPlainPrComment", () => {
  it("routes only the comment state to the comments endpoint", () => {
    expect(isPlainPrComment("comment")).toBe(true);
    expect(isPlainPrComment("approve")).toBe(false);
    expect(isPlainPrComment("request_changes")).toBe(false);
  });
});
