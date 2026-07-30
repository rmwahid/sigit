import { S3Client } from "@aws-sdk/client-s3";
import type { StorageConnection } from "../db/schema/storage";

export function createS3Client(connection: StorageConnection): S3Client {
  return new S3Client({
    region: connection.region,
    endpoint: connection.endpoint,
    credentials: {
      accessKeyId: connection.accessKeyId,
      secretAccessKey: connection.secretAccessKey,
    },
    forcePathStyle: connection.forcePathStyle,
  });
}

export function createS3ClientFromEnv(): S3Client {
  return new S3Client({
    region: process.env.S3_REGION!,
    endpoint: process.env.S3_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
  });
}
