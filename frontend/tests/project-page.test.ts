import { describe, expect, it } from "vitest";
import {
  defaultRef,
  deriveTabKeys,
  groupActivityByDate,
  hasProjectPerm,
  isValidBranchName,
  joinPath,
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
    expect(deriveTabKeys(null, false)).toEqual(["code", "history", "activity", "pull-requests", "settings"]);
  });

  it("collaborator with history sees code/history/activity", () => {
    expect(deriveTabKeys(["view", "history"], false)).toEqual(["code", "history", "activity"]);
  });

  it("collaborator with diff permission gets the pull requests tab", () => {
    expect(deriveTabKeys(["view", "history", "diff"], false)).toEqual(["code", "history", "activity", "pull-requests"]);
  });

  it("collaborator without history sees code only", () => {
    expect(deriveTabKeys(["view"], false)).toEqual(["code"]);
  });

  it("anonymous sees code + history (no activity, no PR, no settings)", () => {
    expect(deriveTabKeys(null, true)).toEqual(["code", "history"]);
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
  it("prefers the default branch, then first branch, then HEAD", () => {
    expect(defaultRef("main", ["main", "dev"])).toBe("main");
    expect(defaultRef(null, ["dev"])).toBe("dev");
    expect(defaultRef(null, [])).toBe("HEAD");
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
