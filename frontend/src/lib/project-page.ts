import type { ProjectPermission } from "./constants/permissions";
import type { ActivityItem, TreeEntry } from "./api/browser";

// Pure helpers for the project page (Code/History/Activity tabs), extracted
// from routes/(app)/projects/[id]/+page.svelte so the tab logic is
// unit-testable instead of living inside the 600-line page component.

export function joinPath(dirPath: string, name: string): string {
  return dirPath ? `${dirPath}/${name}` : name;
}

export function splitPath(dirPath: string): string[] {
  return dirPath ? dirPath.split("/") : [];
}

// Access rule mirroring the backend: admin (null) has everything; anonymous
// public visitors get view + history only; collaborators get their set.
export function hasProjectPerm(
  access: ProjectPermission[] | null,
  isAnon: boolean,
  perm: ProjectPermission
): boolean {
  if (isAnon) return perm === "view" || perm === "history";
  return access === null || access.includes(perm);
}

export type ProjectTabKey = "code" | "history" | "activity" | "settings";

export function deriveTabKeys(access: ProjectPermission[] | null, isAnon: boolean): ProjectTabKey[] {
  const keys: ProjectTabKey[] = ["code"];
  if (hasProjectPerm(access, isAnon, "history")) keys.push("history");
  if (hasProjectPerm(access, isAnon, "history") && !isAnon) keys.push("activity");
  // Settings is admin-only: anonymous visitors never get it, even though
  // their access value is also null (no session).
  if (access === null && !isAnon) keys.push("settings");
  return keys;
}

// Directories first, then alphabetical within each type.
export function sortEntries(entries: TreeEntry[]): TreeEntry[] {
  return [...entries].sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === "tree" ? -1 : 1
  );
}

// Group activity items by calendar date (ISO date prefix), insertion order kept.
export function groupActivityByDate(items: ActivityItem[]): [string, ActivityItem[]][] {
  const map = new Map<string, ActivityItem[]>();
  for (const item of items) {
    const key = String(item.ts).slice(0, 10);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return [...map.entries()];
}

// Branch selector value: prefer the default branch name (never the head SHA,
// which would not match any option), then the first branch, then HEAD.
export function defaultRef(defaultBranch: string | null, branches: string[]): string {
  return defaultBranch ?? branches[0] ?? "HEAD";
}
