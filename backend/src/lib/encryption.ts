import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";

export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(passphrase, salt, ITERATIONS, KEY_LENGTH, DIGEST);
}

export function encrypt(buffer: Buffer, passphrase: string, salt?: Buffer): { ciphertext: Buffer; salt: string; iv: string; tag: string } {
  const usedSalt = salt ?? crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(passphrase, usedSalt);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted,
    salt: usedSalt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decrypt(ciphertext: Buffer, passphrase: string, salt: string, iv: string, tag: string): Buffer {
  const key = deriveKey(passphrase, Buffer.from(salt, "base64"));
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function generateSalt(): string {
  return crypto.randomBytes(SALT_LENGTH).toString("base64");
}
