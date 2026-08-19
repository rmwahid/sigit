import { pgTable, uuid, varchar, text, boolean, jsonb } from "drizzle-orm/pg-core";
import { DEFAULT_ENCRYPTION_KEY_ID } from "@/constants/protocol";
import { createdAt, updatedAt } from "@/db/utils/timestamps";

export const storageConnections = pgTable("storage_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  provider: varchar("provider", { length: 50 }).notNull().default("s3"),
  endpoint: text("endpoint").notNull(),
  region: varchar("region", { length: 100 }).notNull(),
  accessKeyId: text("access_key_id").notNull(),
  secretEncrypted: text("secret_encrypted").notNull(),
  encryptionKeyId: varchar("encryption_key_id", { length: 50 }).notNull().default(DEFAULT_ENCRYPTION_KEY_ID),
  bucket: varchar("bucket", { length: 255 }).notNull(),
  forcePathStyle: boolean("force_path_style").notNull().default(true),
  metadata: jsonb("metadata"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type StorageConnection = typeof storageConnections.$inferSelect;
export type NewStorageConnection = typeof storageConnections.$inferInsert;
