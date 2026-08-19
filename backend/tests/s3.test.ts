import { describe, expect, it } from "bun:test";
import { S3Client } from "@aws-sdk/client-s3";
import { createS3Client } from "@/config/s3";
import { encryptSecret } from "@/lib/secret-encryption";
import type { StorageConnection } from "@/db/schema/storage";

// createS3Client decrypts the stored secret and builds a path-style S3 client
// from the connection row (Hetzner/MinIO/R2 require forcePathStyle).

const baseConnection = {
  id: "0e8d9a4f-6f0a-4c0e-9f9a-3b2f1e0d9c8b",
  name: "minio",
  accessKeyId: "minioadmin",
  region: "us-east-1",
  endpoint: "http://127.0.0.1:9000",
  forcePathStyle: true,
  encryptionKeyId: "v1",
  secretEncrypted: encryptSecret("top-secret").ciphertext,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as StorageConnection;

describe("createS3Client", () => {
  it("builds a path-style client with decrypted credentials", async () => {
    const client = createS3Client(baseConnection);
    expect(client).toBeInstanceOf(S3Client);
    const cfg = client.config;
    // forcePathStyle is a plain boolean; endpoint/region/credentials are
    // lazy provider functions in the AWS SDK v3 config.
    expect(cfg.forcePathStyle).toBe(true);
    expect(typeof cfg.endpoint).toBe("function");
    expect(typeof cfg.credentials).toBe("function");
    expect(await cfg.endpoint()).toBeTruthy();
    expect(await cfg.region()).toBe("us-east-1");
    // The stored secret must round-trip through decryptSecret into the client.
    const creds = (await cfg.credentials()) as { accessKeyId: string; secretAccessKey: string };
    expect(creds.accessKeyId).toBe("minioadmin");
    expect(creds.secretAccessKey).toBe("top-secret");
  });
});
