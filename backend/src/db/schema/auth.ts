import { pgTable, text, timestamp, uniqueIndex, uuid, varchar, integer, boolean } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { DEFAULT_ROLE } from "@/constants/roles";
import { TOKEN_SCOPE_SLUGS } from "@/constants/scopes";
import { DEFAULT_ENCRYPTION_KEY_ID } from "@/constants/protocol";
import { TOKEN_NAME_MAX_LENGTH } from "@/constants/limits";
import { PR_STATUS_SLUGS, MERGE_METHOD_SLUGS, REVIEW_STATE_SLUGS } from "@/constants/pull-requests";
import { createdAt, updatedAt } from "@/db/utils/timestamps";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  // Role values come from constants/roles.ts (single source of truth).
  role: varchar("role", { length: 20 }).notNull().default(DEFAULT_ROLE),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

// Git token: used as the Basic auth password for git push/pull and git-lfs.
// Per-project access is defined in the token_project_scopes table (read/write per project).
// expiresAt is required.
export const tokens = pgTable("tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: TOKEN_NAME_MAX_LENGTH }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// Per-project token scope: a token only works for projects that have a row here.
// "write" automatically includes "read" (push = clone/pull). No row = no access.
export const tokenProjectScopes = pgTable(
  "token_project_scopes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenId: uuid("token_id")
      .notNull()
      .references(() => tokens.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    scope: text("scope", { enum: TOKEN_SCOPE_SLUGS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("token_project_scopes_token_project_unique").on(t.tokenId, t.projectId)]
);

// Per-project collaborator access for regular users: permissions is a set of
// granular keys (see modules/auth/access.ts ALL_PROJECT_PERMISSIONS).
// Admin users bypass this entirely (admin = owner of every project).
export const projectCollaborators = pgTable(
  "project_collaborators",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permissions: text("permissions").array().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("project_collaborators_project_user_unique").on(t.projectId, t.userId)]
);

// Invitation for onboarding: admin invites an email, the user sets their own
// password via the invite link. Token hashed like sessions/tokens (SHA-256).
export const invitations = pgTable("invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull(),
  role: varchar("role", { length: 20 }).notNull().default(DEFAULT_ROLE),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// Email delivery settings (single row, id = "singleton"): Resend API key,
// wrapped with ENCRYPTION_KEYS like storage secrets.
export const emailSettings = pgTable("email_settings", {
  id: varchar("id", { length: 20 }).primaryKey(), // "singleton"
  resendApiKeyEncrypted: text("resend_api_key_encrypted"),
  encryptionKeyId: varchar("encryption_key_id", { length: 50 }).notNull().default(DEFAULT_ENCRYPTION_KEY_ID),
  fromEmail: varchar("from_email", { length: 255 }),
  updatedAt: updatedAt(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Token = typeof tokens.$inferSelect;
export type NewToken = typeof tokens.$inferInsert;
export type TokenProjectScope = typeof tokenProjectScopes.$inferSelect;
export type NewTokenProjectScope = typeof tokenProjectScopes.$inferInsert;

// Pull request: number is sequential per project (never reused). Status is
// terminal for everything except "open" (no reopen; Gitea behavior).
export const pullRequests = pgTable(
  "pull_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    baseBranch: varchar("base_branch", { length: 255 }).notNull(),
    headBranch: varchar("head_branch", { length: 255 }).notNull(),
    baseSha: varchar("base_sha", { length: 40 }).notNull(),
    headSha: varchar("head_sha", { length: 40 }).notNull(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: PR_STATUS_SLUGS }).notNull().default("open"),
    mergeMethod: text("merge_method", { enum: MERGE_METHOD_SLUGS }),
    mergeCommitSha: varchar("merge_commit_sha", { length: 40 }),
    mergedById: uuid("merged_by_id").references(() => users.id, { onDelete: "set null" }),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("pull_requests_project_number_unique").on(t.projectId, t.number)]
);

// General PR comment (conversation), markdown plaintext rendered client-side.
// Allowed on every PR status (discussion stays open on terminal PRs; Gitea).
export const prComments = pgTable("pr_comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  prId: uuid("pr_id")
    .notNull()
    .references(() => pullRequests.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// One review per user per PR (upsert): the latest state wins.
export const prReviews = pgTable(
  "pr_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    prId: uuid("pr_id")
      .notNull()
      .references(() => pullRequests.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    state: text("state", { enum: REVIEW_STATE_SLUGS }).notNull(),
    body: text("body"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("pr_reviews_pr_user_unique").on(t.prId, t.userId)]
);

// Branch protection rule, one row per exact branch pattern. User whitelists
// (restrict merges/pushes) are UUID arrays; empty means "anyone with the base
// permission". Admin bypass is opt-in (fail-closed default).
export const branchProtectionRules = pgTable(
  "branch_protection_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    branchPattern: varchar("branch_pattern", { length: 255 }).notNull(),
    requirePr: boolean("require_pr").notNull().default(false),
    requiredApprovals: integer("required_approvals").notNull().default(0),
    blockOnRequestChanges: boolean("block_on_request_changes").notNull().default(false),
    blockForcePush: boolean("block_force_push").notNull().default(true),
    blockDeletion: boolean("block_deletion").notNull().default(true),
    restrictMergeUserIds: uuid("restrict_merge_user_ids").array(),
    restrictPushUserIds: uuid("restrict_push_user_ids").array(),
    allowAdminBypass: boolean("allow_admin_bypass").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("branch_protection_rules_project_pattern_unique").on(t.projectId, t.branchPattern)]
);

export type PullRequest = typeof pullRequests.$inferSelect;
export type NewPullRequest = typeof pullRequests.$inferInsert;
export type PrComment = typeof prComments.$inferSelect;
export type NewPrComment = typeof prComments.$inferInsert;
export type PrReview = typeof prReviews.$inferSelect;
export type NewPrReview = typeof prReviews.$inferInsert;
export type BranchProtectionRule = typeof branchProtectionRules.$inferSelect;
export type NewBranchProtectionRule = typeof branchProtectionRules.$inferInsert;
