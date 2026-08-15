import { describe, expect, it, afterAll } from "bun:test";
import crypto from "node:crypto";
import { createConnectionFromInput, deleteConnection } from "@/modules/storage/connections";
import { createProject, hardDeleteProject } from "@/modules/projects/projects";
import {
  decryptProjectBuffer,
  encryptProjectBuffer,
  getDecrypted,
  putEncrypted,
} from "@/modules/encryption/at-rest";
import { decryptSecret } from "@/lib/secret-encryption";
import { getObject, objectSize } from "@/modules/storage/objects";

// At-rest encryption: dev DB `sigit` + local MinIO (bucket sigit-test).
const TEST_TIMEOUT = 30000;

const suffix = Date.now().toString(36);
const createdProjectIds: string[] = [];
const createdConnectionIds: string[] = [];

async function makeProject(name: string) {
  const connection = await createConnectionFromInput({
    name: `test-enc-conn-${name}-${suffix}`,
    endpoint: "http://127.0.0.1:9000",
    region: "us-east-1",
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
    bucket: "sigit-test",
    forcePathStyle: true,
  });
  createdConnectionIds.push(connection.id);
  const project = await createProject({ name, storageConnectionId: connection.id });
  createdProjectIds.push(project.id);
  return { project, connection };
}

async function cleanup() {
  for (const id of createdProjectIds) {
    try {
      await hardDeleteProject(id);
    } catch {
      // best effort
    }
  }
  for (const id of createdConnectionIds) {
    try {
      await deleteConnection(id);
    } catch {
      // best effort
    }
  }
}

afterAll(async () => {
  await cleanup();
}, TEST_TIMEOUT);

describe("at-rest encryption", () => {
  it("round-trips a project buffer through encrypt/decrypt", async () => {
    const { project } = await makeProject(`enc-roundtrip-${suffix}`);
    const plaintext = crypto.randomBytes(4096);

    const ciphertext = encryptProjectBuffer(project, plaintext);
    expect(ciphertext.equals(plaintext)).toBe(false);
    expect(ciphertext.length).toBe(plaintext.length + 12 + 16); // iv + authTag

    const decrypted = decryptProjectBuffer(project, ciphertext);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it("rejects tampered ciphertext (GCM authentication)", async () => {
    const { project } = await makeProject(`enc-tamper-${suffix}`);
    const plaintext = Buffer.from("secret payload");

    const ciphertext = encryptProjectBuffer(project, plaintext);
    const tampered = Buffer.from(ciphertext);
    tampered[tampered.length - 1] ^= 0xff;

    expect(() => decryptProjectBuffer(project, tampered)).toThrow();
  });

  it("stores the project key wrapped (never in plaintext)", async () => {
    const { project } = await makeProject(`enc-key-${suffix}`);
    // The stored ciphertext is base64 of iv+tag+encrypted; unwrapping it must
    // yield the 32-byte key material, proving it is encrypted at rest.
    const raw = Buffer.from(project.encryptionKeyEncrypted, "base64");
    expect(raw.length).toBeGreaterThanOrEqual(12 + 16 + 32);
    const unwrapped = decryptSecret({
      keyId: project.encryptionKeyId,
      ciphertext: project.encryptionKeyEncrypted,
    });
    expect(Buffer.from(unwrapped, "hex").length).toBe(32);
  });

  it("stores encrypted bytes in user storage and decrypts on read", async () => {
    const { project, connection } = await makeProject(`enc-storage-${suffix}`);
    const plaintext = crypto.randomBytes(512);
    const key = `projects/${project.id}/lfs/${crypto.createHash("sha256").update(plaintext).digest("hex")}`;

    await putEncrypted(project, connection, key, plaintext);
    // Bytes at rest are NOT the plaintext (encryption proof).
    const raw = await getObject(connection, key);
    expect(raw.equals(plaintext)).toBe(false);
    expect(raw.length).toBe(plaintext.length + 12 + 16);

    // objectSize reflects ciphertext, not plaintext.
    const size = await objectSize(connection, key);
    expect(size).toBe(raw.length);

    // Reads come back as plaintext (transparent).
    const fetched = await getDecrypted(project, connection, key);
    expect(fetched.equals(plaintext)).toBe(true);
  });
});
