import { describe, expect, it } from "bun:test";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/secret-encryption";

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
