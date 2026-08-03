import crypto from "node:crypto";
import { env } from "../config/env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export type EncryptedSecret = {
  keyId: string;
  ciphertext: string; // base64: iv + authTag + encrypted data
};

export function currentKeyId(): string {
  // Use the last key as current (newest)
  const ids = Object.keys(env.ENCRYPTION_KEYS);
  if (ids.length === 0) throw new Error("No encryption keys configured");
  return ids[ids.length - 1];
}

function getKey(keyId: string): Buffer {
  const key = env.ENCRYPTION_KEYS[keyId];
  if (!key) throw new Error(`Encryption key "${keyId}" not found`);
  return Buffer.from(key, "hex");
}

export function encryptSecret(plaintext: string, keyId = currentKeyId()): EncryptedSecret {
  const key = getKey(keyId);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    keyId,
    ciphertext: Buffer.concat([iv, tag, encrypted]).toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const key = getKey(secret.keyId);
  const buf = Buffer.from(secret.ciphertext, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function maskSecret(secret: string): string {
  if (secret.length <= 8) return "***";
  const first = secret.slice(0, 4);
  const last = secret.slice(-4);
  return `${first}***${last}`;
}
