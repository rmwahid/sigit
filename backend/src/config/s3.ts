import { S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import https from "node:https";
import { STORAGE_CONNECTION_TIMEOUT_MS, STORAGE_REQUEST_TIMEOUT_MS, STORAGE_MAX_SOCKETS } from "@/constants/limits";
import { decryptSecret } from "@/lib/secret-encryption";
import type { S3ConnectionLike } from "@/modules/storage/objects";

// The destination is chosen by the project owner (the connection row is user
// input), so an outbound request must not be able to park forever: without a
// deadline a stalled or hostile endpoint holds the caller's buffers in the
// shared process for as long as it likes. A bounded socket pool keeps the number
// of simultaneous storage requests finite as well.
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
    maxAttempts: 2,
    requestHandler: new NodeHttpHandler({
      requestTimeout: STORAGE_REQUEST_TIMEOUT_MS,
      connectionTimeout: STORAGE_CONNECTION_TIMEOUT_MS,
      httpsAgent: new https.Agent({ keepAlive: true, maxSockets: STORAGE_MAX_SOCKETS }),
    }),
  });
}
