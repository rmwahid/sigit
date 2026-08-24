import { S3Client } from "@aws-sdk/client-s3";
import { decryptSecret } from "@/lib/secret-encryption";
import type { S3ConnectionLike } from "@/modules/storage/objects";

export function createS3Client(connection: S3ConnectionLike): S3Client {
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
