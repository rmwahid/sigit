// At-rest encryption for user storage objects (LFS objects + backup bundle).
// Transparent server-side: call sites encrypt before putObject and decrypt after
// getObject. Each project has its own 32-byte AES-256-GCM key, wrapped with
// ENCRYPTION_KEYS and stored on the projects row (never in plaintext).
//
// Ciphertext format (same as secret-encryption.ts):
//   iv(12B) || authTag(16B) || ciphertext
import crypto from "node:crypto";
import type { Project } from "../../db/schema/projects";
import type { StorageConnection } from "../../db/schema/storage";
import { decryptSecret } from "../../lib/secret-encryption";
import { getObject, putObject } from "../storage/objects";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// S3 metadata key that stores the plaintext size (verifyObject compares the
// client-declared size against this, since the ciphertext is 28 bytes larger).
export const PLAINTEXT_SIZE_METADATA = "x-sigit-size";

// Cache decrypted project keys per project id (one decrypt per project per process).
const keyCache = new Map<string, Buffer>();

function getProjectKey(project: Project): Buffer {
  const cached = keyCache.get(project.id);
  if (cached) return cached;
  const raw = decryptSecret({
    keyId: project.encryptionKeyId,
    ciphertext: project.encryptionKeyEncrypted,
  });
  const key = Buffer.from(raw, "hex");
  keyCache.set(project.id, key);
  return key;
}

export function encryptProjectBuffer(project: Project, plaintext: Buffer): Buffer {
  const key = getProjectKey(project);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

export function decryptProjectBuffer(project: Project, ciphertext: Buffer): Buffer {
  const key = getProjectKey(project);
  const iv = ciphertext.subarray(0, IV_LENGTH);
  const tag = ciphertext.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = ciphertext.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

// Encrypts and uploads, storing the plaintext size in object metadata.
export async function putEncrypted(
  project: Project,
  connection: StorageConnection,
  key: string,
  body: Buffer,
  contentType?: string
): Promise<void> {
  const ciphertext = encryptProjectBuffer(project, body);
  await putObject(connection, key, ciphertext, contentType, { [PLAINTEXT_SIZE_METADATA]: String(body.length) });
}

// Downloads and decrypts.
export async function getDecrypted(
  project: Project,
  connection: StorageConnection,
  key: string
): Promise<Buffer> {
  const ciphertext = await getObject(connection, key);
  return decryptProjectBuffer(project, ciphertext);
}
