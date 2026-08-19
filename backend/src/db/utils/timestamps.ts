import { timestamp } from "drizzle-orm/pg-core";

// Timestamp columns repeated by every table: they are part of the SiGit
// schema contract, so the definitions live in one place instead of being
// re-declared in each table file. Factory functions (not shared column
// instances): drizzle binds each column instance to its own table.
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();
