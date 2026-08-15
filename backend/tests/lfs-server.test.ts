import { describe, expect, it } from "bun:test";
import { sha256 } from "@/modules/lfs";
import {
  buildBatchResponse,
  isValidOid,
  lfsObjectKey,
  verifyLfsContent,
} from "@/modules/lfs/server";

describe("lfs server (batch, oid verification, storage keys)", () => {
  it("builds storage key projects/{id}/lfs/{oid}", () => {
    expect(lfsObjectKey("proj-1", "abc123")).toBe("projects/proj-1/lfs/abc123");
  });

  it("validates oid format (64 hex)", () => {
    expect(isValidOid("a".repeat(64))).toBe(true);
    expect(isValidOid("A".repeat(64))).toBe(false); // uppercase is not valid
    expect(isValidOid("a".repeat(63))).toBe(false);
    expect(isValidOid("z".repeat(64))).toBe(false);
  });

  it("verifies content against oid (sha256)", () => {
    const content = Buffer.from("big file content");
    const oid = sha256(content);
    expect(verifyLfsContent(content, oid)).toBe(true);
    expect(verifyLfsContent(Buffer.from("tampered"), oid)).toBe(false);
  });

  it("builds upload batch with upload+verify actions", async () => {
    const oid = sha256(Buffer.from("x"));
    const payload = await buildBatchResponse({
      operation: "upload",
      objects: [{ oid, size: 1 }],
      baseUrl: "https://sigit.example/projects/my-repo.git/info/lfs/objects",
    });
    expect(payload.transfer).toBe("basic");
    const entry = payload.objects[0];
    expect(entry.oid).toBe(oid);
    expect(entry.authenticated).toBe(true);
    expect(entry.actions?.upload?.href).toBe(`https://sigit.example/projects/my-repo.git/info/lfs/objects/${oid}`);
    expect(entry.actions?.verify?.href).toBe(`https://sigit.example/projects/my-repo.git/info/lfs/objects/${oid}/verify`);
    expect(entry.actions?.download).toBeUndefined();
  });

  it("omits the upload action when the object exceeds the max size", async () => {
    const oid = sha256(Buffer.from("z"));
    const payload = await buildBatchResponse({
      operation: "upload",
      objects: [{ oid, size: 3 * 1024 * 1024 * 1024 }],
      baseUrl: "https://sigit.example/projects/my-repo.git/info/lfs/objects",
      maxObjectBytes: 2 * 1024 * 1024 * 1024,
    });
    expect(payload.objects[0].actions).toBeUndefined();
  });

  it("builds download batch with action only when object exists", async () => {
    const oid = sha256(Buffer.from("y"));
    const exists = async (o: string) => o === oid;
    const payload = await buildBatchResponse({
      operation: "download",
      objects: [{ oid, size: 1 }, { oid: "b".repeat(64), size: 2 }],
      baseUrl: "https://sigit.example/projects/my-repo.git/info/lfs/objects",
      exists,
    });
    expect(payload.objects[0].actions?.download?.href).toContain(oid);
    // second object missing in storage -> no action (spec: client must not retry)
    expect(payload.objects[1].actions).toBeUndefined();
  });
});
