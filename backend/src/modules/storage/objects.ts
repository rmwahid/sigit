import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
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
