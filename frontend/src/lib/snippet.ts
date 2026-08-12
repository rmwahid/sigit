// Pure helpers to build copy-paste git setup snippets for a project page.
// Kept DOM-free so they are unit-testable with vitest.

// Matches backend parsing in modules/lfs/index.ts (comma separated, trimmed).
export function parseLfsPatterns(patterns?: string | null): string[] {
  return (patterns ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

export function gitRemoteCommands(baseUrl: string, projectName: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `git remote add sigit ${base}/projects/${projectName}.git\ngit push -u sigit main`;
}

export function lfsCommands(patterns: string[]): string {
  const lines = ["git lfs install"];
  if (patterns.length > 0) {
    lines.push(`git lfs track ${patterns.map((p) => `"${p}"`).join(" ")}`);
  }
  return lines.join("\n");
}
