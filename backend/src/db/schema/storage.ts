import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const storageConnections = pgTable("storage_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  provider: varchar("provider", { length: 50 }).notNull().default("s3"),
  endpoint: text("endpoint").notNull(),
  region: varchar("region", { length: 100 }).notNull(),
  accessKeyId: text("access_key_id").notNull(),
  secretAccessKey: text("secret_access_key").notNull(),
  bucket: varchar("bucket", { length: 255 }).notNull(),
  forcePathStyle: boolean("force_path_style").notNull().default(true),
  useEncryption: boolean("use_encryption").notNull().default(false),
  encryptionSalt: text("encryption_salt"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type StorageConnection = typeof storageConnections.$inferSelect;
export type NewStorageConnection = typeof storageConnections.$inferInsert;
