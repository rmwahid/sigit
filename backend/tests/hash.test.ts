import { describe, expect, it } from "bun:test";
import { sha256 } from "@/lib/hash";
import { createHash } from "node:crypto";

describe("sha256", () => {
  it("hashes strings to lowercase hex", () => {
    const expected = createHash("sha256").update("e2e").digest("hex");
    expect(sha256("e2e")).toBe(expected);
    expect(sha256("e2e")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hashes buffers identically to node crypto", () => {
    const buf = Buffer.from("hello lfs");
    expect(sha256(buf)).toBe(createHash("sha256").update(buf).digest("hex"));
  });
});
