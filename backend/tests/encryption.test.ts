import { describe, expect, it } from "bun:test";
import { createLfsPointer, parseLfsPointer, sha256 } from "../src/modules/lfs";
import { decrypt, encrypt, generateSalt } from "../src/lib/encryption";

describe("encryption", () => {
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

describe("lfs pointer", () => {
  it("creates and parses pointer", () => {
    const oid = sha256(Buffer.from("hello"));
    const pointer = createLfsPointer(oid, 5);
    const parsed = parseLfsPointer(pointer);
    expect(parsed?.oid).toBe(oid);
    expect(parsed?.size).toBe(5);
  });
});
