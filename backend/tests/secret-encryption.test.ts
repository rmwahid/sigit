import { describe, expect, it } from "bun:test";
import { decryptSecret, encryptSecret, maskSecret } from "../src/lib/secret-encryption";
import { decrypt, encrypt, generateSalt } from "../src/lib/encryption";

describe("secret encryption", () => {
  it("round-trips a secret using v1 key", () => {
    const secret = "super-secret-s3-key-123456";
    const enc = encryptSecret(secret, "v1");
    expect(enc.keyId).toBe("v1");
    expect(decryptSecret(enc)).toBe(secret);
  });

  it("masks secret", () => {
    expect(maskSecret("ABCDEFGHIJKL")).toBe("ABCD***IJKL");
    expect(maskSecret("short").includes("*")).toBe(true);
  });
});

describe("file encryption (client-side)", () => {
  it("round-trips a buffer", () => {
    const plaintext = Buffer.from("hello SiGit");
    const passphrase = "secret-passphrase";
    const salt = generateSalt();
    const result = encrypt(plaintext, passphrase, Buffer.from(salt, "base64"));
    const ciphertext = Buffer.concat([
      Buffer.from(result.iv, "base64"),
      Buffer.from(result.tag, "base64"),
      result.ciphertext,
    ]);
    const iv = ciphertext.subarray(0, 16);
    const tag = ciphertext.subarray(16, 32);
    const encrypted = ciphertext.subarray(32);
    const decrypted = decrypt(encrypted, passphrase, result.salt, iv.toString("base64"), tag.toString("base64"));
    expect(decrypted.toString()).toBe("hello SiGit");
  });
});
