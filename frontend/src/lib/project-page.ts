import type { ProjectPermission } from "./constants/permissions";
import { BRANCH_NAME_MAX_LENGTH, BRANCH_NAME_PATTERN } from "./constants/validation";
import { AUDIT_EVENTS } from "./constants/audit-events";
import type { ActivityItem, TreeEntry } from "./api/browser";
import { PR_MERGEABLE_STATUS_BY_SLUG, PR_STATUS_BY_SLUG, REVIEW_STATE_BY_SLUG, type PrMergeableStatus, type PrStatus } from "./constants/pull-requests";

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

export type ProjectTabKey = "code" | "history" | "activity" | "pull-requests" | "settings";

export function deriveTabKeys(access: ProjectPermission[] | null, isAnon: boolean): ProjectTabKey[] {
  const keys: ProjectTabKey[] = ["code"];
  if (hasProjectPerm(access, isAnon, "history")) keys.push("history");
  // Pull requests need the diff permission for the preview; anonymous
  // visitors on public projects get view+history only, so no PR tab.
  if (hasProjectPerm(access, isAnon, "diff") && !isAnon) keys.push("pull-requests");
  if (hasProjectPerm(access, isAnon, "history") && !isAnon) keys.push("activity");
  // Settings is admin-only: anonymous visitors never get it, even though
  // their access value is also null (no session).
  if (access === null && !isAnon) keys.push("settings");
  return keys;
}

// Human-readable line for an activity feed item (commits + audit events).
// Events carry raw snake_case names with machine fields; this maps them to
// plain sentences the way a project feed should read. Unknown events fall
// back to the event name so new audit calls never render blank.

// Display name for a PR status slug, from the shared constants. Unknown
// slugs render as-is so forward-compatible payloads never crash the feed.
function prStatusDisplay(slug: string): string {
  return PR_STATUS_BY_SLUG[slug as PrStatus]?.name ?? slug;
}

// Parenthesized extras appended to activity sentences. Every event in the
// feed carries its own payload (the backend audits only real changes), so
// these read the fields directly without legacy fallbacks.
function prDetails(item: ActivityItem): string {
  return ` (${String(item.headBranch ?? "")} -> ${String(item.baseBranch ?? "")})`;
}

function mergeDetails(item: ActivityItem): string {
  const method = String(item.method ?? "");
  const sha = String(item.mergeCommitSha ?? "").slice(0, 7);
  return ` (${method}, ${sha})`;
}

function editFields(item: ActivityItem): string {
  const fields = (item.fields as unknown[] | undefined) ?? [];
  return fields.length ? ` (${fields.map(String).join(", ")})` : "";
}

export function formatActivityItem(item: ActivityItem): string {
  if (item.type === "commit") {
    return `${String(item.author ?? "")} committed ${String(item.message ?? "")}`;
  }
  const ev = String(item.event ?? "");
  const by = (v: unknown) => (v ? ` by ${String(v)}` : "");
  const pr = (n: unknown) => `#${String(n ?? "")}`;
  switch (ev) {
    case AUDIT_EVENTS.GIT_PUSH:
      return `Pushed to ${String(item.ref ?? "")}${by(item.by)}`;
    case AUDIT_EVENTS.LFS_UPLOAD:
      return `Uploaded LFS object ${String(item.oid ?? "").slice(0, 10)}${by(item.by)}`;
    case AUDIT_EVENTS.LFS_DOWNLOAD:
      return `Downloaded LFS object ${String(item.oid ?? "").slice(0, 10)}${by(item.by)}`;
    case AUDIT_EVENTS.PROJECT_CREATE_WITH_CONNECTION:
      return `Created project${by(item.by)}`;
    case AUDIT_EVENTS.PROJECT_DELETE:
      return `Deleted project${by(item.by)}`;
    case AUDIT_EVENTS.PROJECT_BACKUP:
      return `Created a backup${by(item.by)}`;
    case AUDIT_EVENTS.PROJECT_RESTORE:
      return `Restored from backup${by(item.by)}`;
    case AUDIT_EVENTS.PROJECT_COLLABORATOR_ADD:
      return `Added a collaborator${by(item.by)}`;
    case AUDIT_EVENTS.PROJECT_COLLABORATOR_UPDATE:
      return `Updated a collaborator's permissions${by(item.by)}`;
    case AUDIT_EVENTS.PROJECT_COLLABORATOR_REMOVE:
      return `Removed a collaborator${by(item.by)}`;
    case AUDIT_EVENTS.BRANCH_CREATE:
      return `Created branch ${String(item.branch ?? "")}${by(item.by)}`;
    case AUDIT_EVENTS.BRANCH_DELETE:
      return `Deleted branch ${String(item.branch ?? "")}${by(item.by)}`;
    case AUDIT_EVENTS.PULL_REQUEST_CREATE:
      return `Opened pull request ${pr(item.prNumber)}${prDetails(item)}${by(item.by)}`;
    case AUDIT_EVENTS.PULL_REQUEST_UPDATE:
      return `Updated pull request ${pr(item.prNumber)}${editFields(item)}${by(item.by)}`;
    case AUDIT_EVENTS.PULL_REQUEST_STATUS_CHANGE:
      return `Changed status of pull request ${pr(item.prNumber)} to ${prStatusDisplay(String(item.to ?? ""))}${by(item.by)}`;
    case AUDIT_EVENTS.PULL_REQUEST_DELETE:
      return `Deleted pull request ${pr(item.prNumber)}${by(item.by)}`;
    case AUDIT_EVENTS.PULL_REQUEST_MERGE:
      return `Merged pull request ${pr(item.prNumber)}${mergeDetails(item)}${by(item.by)}`;
    case AUDIT_EVENTS.PULL_REQUEST_COMMENT:
      return `Commented on pull request ${pr(item.prNumber)}${by(item.by)}`;
    case AUDIT_EVENTS.PULL_REQUEST_REVIEW:
      return `${reviewActionLabel(String(item.state))} pull request ${pr(item.prNumber)}${by(item.by)}`;
    case AUDIT_EVENTS.PROTECTION_CREATE:
      return `Added protection for ${String(item.branchPattern ?? "")}${by(item.by)}`;
    case AUDIT_EVENTS.PROTECTION_UPDATE:
      return `Updated protection for ${String(item.branchPattern ?? "")}${by(item.by)}`;
    case AUDIT_EVENTS.PROTECTION_DELETE:
      return `Removed protection for ${String(item.branchPattern ?? "")}${by(item.by)}`;
    case AUDIT_EVENTS.TOKEN_CREATE:
      return `Created a new token${by(item.by)}`;
    case AUDIT_EVENTS.TOKEN_REVOKE:
      return `Revoked a token${by(item.by)}`;
    case AUDIT_EVENTS.INVITATION_CREATE:
      return `Invited ${String(item.email ?? "")}${by(item.by)}`;
    case AUDIT_EVENTS.INVITATION_REVOKE:
      return `Revoked an invitation${by(item.by)}`;
    case AUDIT_EVENTS.AUTH_LOGIN:
      return `${String(item.email ?? "")} signed in`;
    case AUDIT_EVENTS.AUTH_LOGOUT:
      return `Signed out`;
    case AUDIT_EVENTS.AUTH_REVOKE_ALL:
      return `Revoked all sessions${by(item.by)}`;
    case AUDIT_EVENTS.AUTH_CHANGE_PASSWORD:
      return `Changed password${by(item.by)}`;
    case AUDIT_EVENTS.AUTH_INVITE_ACCEPT:
      return `${String(item.email ?? "")} accepted the invitation`;
    case AUDIT_EVENTS.USER_UPDATE:
      return `Updated a user${by(item.by)}`;
    case AUDIT_EVENTS.USER_RESET_PASSWORD:
      return `Reset a user's password${by(item.by)}`;
    case AUDIT_EVENTS.USER_DELETE:
      return `Deleted a user${by(item.by)}`;
    case AUDIT_EVENTS.STORAGE_CREATE_CONNECTION:
      return `Added a storage connection${by(item.by)}`;
    case AUDIT_EVENTS.STORAGE_DELETE_CONNECTION:
      return `Removed a storage connection${by(item.by)}`;
    case AUDIT_EVENTS.STORAGE_DELETE_OBJECT:
      return `Deleted a storage object${by(item.by)}`;
    case AUDIT_EVENTS.EMAIL_UPDATE:
      return `Updated email settings${by(item.by)}`;
    case AUDIT_EVENTS.EMAIL_TEST:
      return `Sent a test email${by(item.by)}`;
    default:
      return ev;
  }
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

// Rich text (Tiptap) content counts as empty when it holds no text at all:
// an empty paragraph serializes to "<p></p>", which still has a length.
// DOM-free on purpose (no jsdom in unit tests): strip tags and entities,
// then check whether anything remains.
export function emptyRichText(html: string): boolean {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return !text.trim();
}

// Pull request badge helpers (single source of truth = constants). The
// lookups are slug-indexed maps, so unknown values are a type error instead
// of a silent fallback.

export function prStatusLabel(status: PrStatus): string {
  return PR_STATUS_BY_SLUG[status].name;
}

export function prStatusBadgeClass(status: PrStatus): string {
  switch (status) {
    case PR_STATUS_BY_SLUG.merged.slug:
      return "border-success bg-success text-success-foreground";
    case PR_STATUS_BY_SLUG.abandoned.slug:
      return "border-vivid bg-vivid text-vivid-foreground";
    case PR_STATUS_BY_SLUG.rejected.slug:
      return "border-destructive bg-destructive text-destructive-foreground";
    default:
      return "border-border bg-muted";
  }
}

export function prMergeableLabel(status: PrMergeableStatus): string {
  return PR_MERGEABLE_STATUS_BY_SLUG[status].name;
}

export function prMergeableBadgeClass(status: PrMergeableStatus): string {
  switch (status) {
    case PR_MERGEABLE_STATUS_BY_SLUG.mergeable.slug:
      return "border-border bg-accent text-accent-foreground";
    case PR_MERGEABLE_STATUS_BY_SLUG.conflict.slug:
      return "border-destructive/40 bg-destructive/10 text-destructive";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

// Mirror of the backend branch name rule (routes/branches.ts): non-empty,
// only [A-Za-z0-9._/-], no "..". The server re-checks with git
// check-ref-format, which is stricter about trailing dots/slashes.
export function isValidBranchName(name: string): boolean {
  if (!name || name.length > BRANCH_NAME_MAX_LENGTH || name.includes("..")) return false;
  return new RegExp(BRANCH_NAME_PATTERN).test(name);
}

// Activity sentence for a pull request review event, keyed by review state.
// The fallback ("Reviewed") only applies to the generic comment state.
export function reviewActionLabel(state: string): string {
  switch (state) {
    case REVIEW_STATE_BY_SLUG.approve.slug:
      return "Approved";
    case REVIEW_STATE_BY_SLUG.request_changes.slug:
      return "Requested changes on";
    default:
      return "Reviewed";
  }
}

// Whether a composer submission with the given review state is a plain
// conversation comment (new entry every time) or a review. Comment is the
// only state routed to the comments endpoint; approve/request_changes go
// through the reviews endpoint (append-only rows).
export function isPlainPrComment(state: string): boolean {
  return state === REVIEW_STATE_BY_SLUG.comment.slug;
}
