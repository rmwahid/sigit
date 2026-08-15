import { describe, expect, it } from "vitest";
import { gitRemoteCommands, lfsCommands, parseLfsPatterns } from "$lib/snippet";

describe("parseLfsPatterns", () => {
  it("splits comma separated patterns and trims whitespace", () => {
    expect(parseLfsPatterns("*.mp4, *.zip ,*.png")).toEqual(["*.mp4", "*.zip", "*.png"]);
  });

  it("filters empty entries", () => {
    expect(parseLfsPatterns("*.mp4,, *.zip,")).toEqual(["*.mp4", "*.zip"]);
  });

  it("returns empty array for null or undefined", () => {
    expect(parseLfsPatterns(null)).toEqual([]);
    expect(parseLfsPatterns(undefined)).toEqual([]);
    expect(parseLfsPatterns("")).toEqual([]);
  });
});

describe("gitRemoteCommands", () => {
  it("builds remote add and first push commands", () => {
    const commands = gitRemoteCommands("http://localhost:3000", "my-proj");
    expect(commands).toBe(
      "git remote add sigit http://localhost:3000/projects/my-proj.git\ngit push -u sigit main"
    );
  });

  it("strips trailing slashes from base url", () => {
    const commands = gitRemoteCommands("https://git.example.com/", "proj");
    expect(commands).toContain("https://git.example.com/projects/proj.git");
  });
});

describe("lfsCommands", () => {
  it("includes install and track lines with quoted patterns", () => {
    const commands = lfsCommands(["*.mp4", "*.zip"]);
    expect(commands).toBe('git lfs install\ngit lfs track "*.mp4" "*.zip"');
  });

  it("skips track line when no patterns", () => {
    expect(lfsCommands([])).toBe("git lfs install");
  });
});
