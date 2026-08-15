import { S3Client } from "@aws-sdk/client-s3";
import type { StorageConnection } from "@/db/schema/storage";
import { decryptSecret } from "@/lib/secret-encryption";

export function createS3Client(connection: StorageConnection): S3Client {
  const secretAccessKey = decryptSecret({
    keyId: connection.encryptionKeyId,
    ciphertext: connection.secretEncrypted,
  });
  return new S3Client({
    region: connection.region,
    endpoint: connection.endpoint,
    credentials: {
      accessKeyId: connection.accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: connection.forcePathStyle,
  });
}
