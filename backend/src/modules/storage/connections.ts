import { eq } from "drizzle-orm";
import { db } from "../../config/db";
import { storageConnections, type NewStorageConnection, type StorageConnection } from "../../db/schema/storage";
import { encryptSecret } from "../../lib/secret-encryption";

export type StorageConnectionInput = {
  name: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle?: boolean;
};

// Create a connection from raw user input: encrypt the secret.
// Accepts db or tx so it can run inside a transaction
// (e.g. createProjectWithConnection).
export async function createConnectionFromInput(
  data: StorageConnectionInput,
  client: Pick<typeof db, "insert"> = db
): Promise<StorageConnection> {
  const encrypted = encryptSecret(data.secretAccessKey);
  const rows = await client
    .insert(storageConnections)
    .values({
      name: data.name,
      endpoint: data.endpoint,
      region: data.region,
      accessKeyId: data.accessKeyId,
      secretEncrypted: encrypted.ciphertext,
      encryptionKeyId: encrypted.keyId,
      bucket: data.bucket,
      forcePathStyle: data.forcePathStyle ?? true,
    })
    .returning();
  const connection = rows[0];
  if (!connection) throw new Error("Failed to create connection");
  return connection;
}

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
