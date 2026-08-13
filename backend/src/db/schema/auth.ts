import { pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { DEFAULT_ROLE } from "../../constants/roles";
import { TOKEN_SCOPE_SLUGS } from "../../constants/scopes";
import { DEFAULT_ENCRYPTION_KEY_ID } from "../../constants/protocol";
import { TOKEN_NAME_MAX_LENGTH } from "../../constants/limits";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  // Role values come from constants/roles.ts (single source of truth).
  role: varchar("role", { length: 20 }).notNull().default(DEFAULT_ROLE),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Email delivery settings (single row, id = "singleton"): Resend API key,
// wrapped with ENCRYPTION_KEYS like storage secrets.
export const emailSettings = pgTable("email_settings", {
  id: varchar("id", { length: 20 }).primaryKey(), // "singleton"
  resendApiKeyEncrypted: text("resend_api_key_encrypted"),
  encryptionKeyId: varchar("encryption_key_id", { length: 50 }).notNull().default(DEFAULT_ENCRYPTION_KEY_ID),
  fromEmail: varchar("from_email", { length: 255 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Token = typeof tokens.$inferSelect;
export type NewToken = typeof tokens.$inferInsert;
export type TokenProjectScope = typeof tokenProjectScopes.$inferSelect;
export type NewTokenProjectScope = typeof tokenProjectScopes.$inferInsert;
