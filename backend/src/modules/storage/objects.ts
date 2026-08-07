import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import type { StorageConnection } from "../../db/schema/storage";
import { createS3Client } from "../../config/s3";

export async function testConnection(connection: StorageConnection): Promise<{ ok: boolean; error?: string }> {
  const client = createS3Client(connection);
  try {
    await client.send(new HeadBucketCommand({ Bucket: connection.bucket }));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function listObjects(connection: StorageConnection, prefix?: string): Promise<{ key?: string; size?: number; lastModified?: Date }[]> {
  const client = createS3Client(connection);
  const command = new ListObjectsV2Command({
    Bucket: connection.bucket,
    Prefix: prefix,
  });
  const response = await client.send(command);
  return (response.Contents ?? []).map((obj) => ({
    key: obj.Key,
    size: obj.Size,
    lastModified: obj.LastModified,
  }));
}

export async function getObject(connection: StorageConnection, key: string): Promise<Buffer> {
  const client = createS3Client(connection);
  const response = await client.send(new GetObjectCommand({ Bucket: connection.bucket, Key: key }));
  const stream = response.Body;
  if (!stream) throw new Error("Empty object body");
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function putObject(connection: StorageConnection, key: string, body: Buffer, contentType?: string): Promise<void> {
  const client = createS3Client(connection);
  await client.send(
    new PutObjectCommand({
      Bucket: connection.bucket,
      Key: key,
      Body: body,
      ContentType: contentType ?? "application/octet-stream",
    })
  );
}

export async function deleteObject(connection: StorageConnection, key: string): Promise<void> {
  const client = createS3Client(connection);
  await client.send(new DeleteObjectCommand({ Bucket: connection.bucket, Key: key }));
}

export async function listAllObjects(connection: StorageConnection, prefix?: string): Promise<string[]> {
  const client = createS3Client(connection);
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const command = new ListObjectsV2Command({
      Bucket: connection.bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });
    const response = await client.send(command);
    for (const obj of response.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  return keys;
}

export async function deleteObjectsByPrefix(connection: StorageConnection, prefix: string): Promise<number> {
  const keys = await listAllObjects(connection, prefix);
  if (keys.length === 0) return 0;
  const client = createS3Client(connection);
  // Delete in batches of 1000 (S3 limit)
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000).map((k) => ({ Key: k }));
    await client.send(new DeleteObjectsCommand({ Bucket: connection.bucket, Delete: { Objects: batch } }));
  }
  return keys.length;
}
