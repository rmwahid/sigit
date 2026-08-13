import { pgTable, uuid, varchar, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { DEFAULT_ENCRYPTION_KEY_ID } from "../../constants/protocol";

// Default LFS file threshold (10 MB). Single source of truth - also used by
// routes/schemas/projects.ts, modules/projects/git.ts, and cli/e2e-lfs.ts.
export const DEFAULT_LFS_SIZE_THRESHOLD = 10 * 1024 * 1024;

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull().unique(), // unique: used in the git URL /projects/<name>.git
  description: text("description"),
  storageConnectionId: uuid("storage_connection_id"),
  lfsSizeThreshold: integer("lfs_size_threshold").notNull().default(DEFAULT_LFS_SIZE_THRESHOLD), // 10 MB
  lfsPatterns: text("lfs_patterns").default("*.png,*.jpg,*.jpeg,*.gif,*.mp4,*.mov,*.zip,*.tar.gz,*.psd,*.ai,*.exe,*.bin,*.pdf"),
  // Per-project encryption key for at-rest encryption (LFS objects + backup bundle).
  // The raw 32-byte key is encrypted with ENCRYPTION_KEYS (secret-encryption.ts),
  // never stored in plaintext. NOT NULL - no legacy/plaintext projects.
  encryptionKeyEncrypted: text("encryption_key_encrypted").notNull(),
  encryptionKeyId: varchar("encryption_key_id", { length: 50 }).notNull().default(DEFAULT_ENCRYPTION_KEY_ID),
  // Public projects allow anonymous read-only clone (git + LFS download).
  isPublic: boolean("is_public").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
