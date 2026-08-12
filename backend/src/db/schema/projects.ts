import { pgTable, uuid, varchar, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";

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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
