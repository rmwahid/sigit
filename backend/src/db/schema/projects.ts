import { pgTable, uuid, varchar, text, integer, boolean } from "drizzle-orm/pg-core";
import { DEFAULT_ENCRYPTION_KEY_ID } from "@/constants/protocol";
import { DEFAULT_LFS_SIZE_THRESHOLD } from "@/constants/limits";
import { createdAt, updatedAt } from "@/db/utils/timestamps";

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
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
