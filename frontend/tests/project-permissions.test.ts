import { describe, expect, it } from "vitest";
import {
  ALL_PROJECT_PERMISSIONS,
  DEFAULT_COLLAB_PERMISSIONS,
  PERMISSION_GROUPS,
  PROJECT_PERMISSIONS,
  permissionName,
} from "$lib/constants/permissions";

describe("project permissions", () => {
  it("covers the 7 granular permissions (matches backend)", () => {
    expect(ALL_PROJECT_PERMISSIONS).toEqual([
      "clone",
      "push",
      "lfsDownload",
      "lfsUpload",
      "view",
      "history",
      "diff",
    ]);
  });

  it("groups every permission exactly once with a name", () => {
    const flat = PERMISSION_GROUPS.flatMap((g) => g.keys);
    expect(new Set(flat).size).toBe(flat.length);
    expect(flat.sort()).toEqual([...ALL_PROJECT_PERMISSIONS].sort());
    for (const perm of ALL_PROJECT_PERMISSIONS) {
      expect(typeof permissionName(perm)).toBe("string");
    }
  });

  it("provides a sane default collaborator permission set", () => {
    expect(DEFAULT_COLLAB_PERMISSIONS).toEqual([
      PROJECT_PERMISSIONS.CLONE.slug,
      PROJECT_PERMISSIONS.VIEW.slug,
    ]);
  });
});
