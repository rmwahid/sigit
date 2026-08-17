import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listPublicProjects } from "@/modules/auth/access";
import { projectRepoPath } from "@/modules/projects/projects";

const execFileAsync = promisify(execFile);

export type ActivityDay = { date: string; count: number };

// Cap for one repo's commit log output (matches the file browser cap).
const MAX_ACTIVITY_LOG_BYTES = 32 * 1024 * 1024;

// Per-day commit counts for one author email in a single bare repo, from the
// date of `sinceIso` (ISO timestamp) onward. Email matching is exact: git's
// --author flag is regex-based and emails are not safe patterns.
//
// The window is filtered here, NOT with git log --since: --since prunes the
// history walk at the first old commit, so a commit dated before its parent
// (e.g. a cherry-pick) would hide every newer ancestor behind it.
export async function getCommitDays(repoPath: string, authorEmail: string, sinceIso: string): Promise<Map<string, number>> {
  const { stdout } = await execFileAsync(
    "git",
    ["log", "--all", "--format=%ae%x1f%ad", "--date=short"],
    { cwd: repoPath, encoding: "buffer", maxBuffer: MAX_ACTIVITY_LOG_BYTES }
  );
  const sinceKey = sinceIso.slice(0, 10);
  const counts = new Map<string, number>();
  for (const line of stdout.toString("utf8").split("\n")) {
    if (!line) continue;
    const sep = line.indexOf("\x1f");
    if (sep === -1) continue;
    if (line.slice(0, sep) !== authorEmail) continue;
    const date = line.slice(sep + 1).trim();
    if (!date || date < sinceKey) continue;
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  return counts;
}

// Sum several per-repo day maps into one.
export function mergeDayCounts(sources: Map<string, number>[]): Map<string, number> {
  const merged = new Map<string, number>();
  for (const source of sources) {
    for (const [date, count] of source) {
      merged.set(date, (merged.get(date) ?? 0) + count);
    }
  }
  return merged;
}

// Commit activity for one author email across every PUBLIC project. Public
// only: this feeds the public profile page, so private repos never leak.
// The window starts on Jan 1 of the current year (the graph shows the full
// calendar year). Missing or empty repos are skipped, not errors.
export async function getUserActivity(email: string, now = new Date()): Promise<ActivityDay[]> {
  const since = new Date(now.getFullYear(), 0, 1).toISOString();
  const publicProjects = await listPublicProjects();
  const perRepo: Map<string, number>[] = [];
  for (const project of publicProjects) {
    const repoPath = projectRepoPath(project.id);
    const days = await getCommitDays(repoPath, email, since).catch(() => new Map<string, number>());
    perRepo.push(days);
  }
  return [...mergeDayCounts(perRepo).entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
