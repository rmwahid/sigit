import { eq } from "drizzle-orm";
import { db } from "../../config/db";
import { storageConnections, type NewStorageConnection, type StorageConnection } from "../../db/schema/storage";

export async function listConnections(): Promise<StorageConnection[]> {
  return db.select().from(storageConnections);
}

export async function getConnection(id: string): Promise<StorageConnection | undefined> {
  const rows = await db.select().from(storageConnections).where(eq(storageConnections.id, id));
  return rows[0];
}

export async function createConnection(data: NewStorageConnection): Promise<StorageConnection> {
  const rows = await db.insert(storageConnections).values(data).returning();
  return rows[0];
}

export async function updateConnection(id: string, data: Partial<NewStorageConnection>): Promise<StorageConnection | undefined> {
  const rows = await db
    .update(storageConnections)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(storageConnections.id, id))
    .returning();
  return rows[0];
}

export async function deleteConnection(id: string): Promise<boolean> {
  const rows = await db.delete(storageConnections).where(eq(storageConnections.id, id)).returning();
  return rows.length > 0;
}
