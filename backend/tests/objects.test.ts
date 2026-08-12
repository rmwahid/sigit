import { describe, expect, it, afterAll } from "bun:test";
import crypto from "node:crypto";
import { createConnectionFromInput, deleteConnection, getConnection } from "../src/modules/storage/connections";
import {
  deleteObject,
  deleteObjectsByPrefix,
  getObject,
  listAllObjects,
  listObjects,
  putObject,
  testConnection,
} from "../src/modules/storage/objects";

// Local MinIO (via FlyEnv). Connection is created inline like user input.
const TEST_TIMEOUT = 30000;

const suffix = Date.now().toString(36);
const connectionName = `test-objects-conn-${suffix}`;
const prefix = `test-objects/${suffix}/`;
let connectionId: string;

afterAll(async () => {
  try {
    await deleteConnection(connectionId);
  } catch {
    // best effort
  }
}, TEST_TIMEOUT);

describe("storage objects (MinIO)", () => {
  it("creates a connection and tests it", async () => {
    const conn = await createConnectionFromInput({
      name: connectionName,
      endpoint: "http://127.0.0.1:9000",
      region: "us-east-1",
      accessKeyId: "minioadmin",
      secretAccessKey: "minioadmin",
      bucket: "sigit-test",
      forcePathStyle: true,
    });
    connectionId = conn.id;
    expect(conn.secretEncrypted).toBeTruthy();

    const result = await testConnection(conn);
    expect(result.ok).toBe(true);
  }, TEST_TIMEOUT);

  it("round-trips an object (put + get)", async () => {
    const conn = (await getConnection(connectionId))!;
    const content = crypto.randomBytes(4096);
    const key = `${prefix}roundtrip.bin`;
    await putObject(conn, key, content, "application/octet-stream");

    const fetched = await getObject(conn, key);
    expect(fetched.equals(content)).toBe(true);
  }, TEST_TIMEOUT);

  it("lists objects with a prefix", async () => {
    const conn = (await getConnection(connectionId))!;
    const objects = await listObjects(conn, prefix);
    expect(objects.length).toBeGreaterThan(0);
    expect(objects[0].key).toContain(prefix);
  }, TEST_TIMEOUT);

  it("deletes a single object", async () => {
    const conn = (await getConnection(connectionId))!;
    const key = `${prefix}delete-me.bin`;
    await putObject(conn, key, Buffer.from("bye"));

    await deleteObject(conn, key);
    const remaining = await listAllObjects(conn, key);
    expect(remaining).toHaveLength(0);
  }, TEST_TIMEOUT);

  it("deletes all objects under a prefix", async () => {
    const conn = (await getConnection(connectionId))!;
    for (let i = 0; i < 3; i++) {
      await putObject(conn, `${prefix}batch-${i}.bin`, Buffer.from(`data-${i}`));
    }
    const deleted = await deleteObjectsByPrefix(conn, prefix);
    expect(deleted).toBeGreaterThanOrEqual(3);
    expect(await listAllObjects(conn, prefix)).toHaveLength(0);
  }, TEST_TIMEOUT);
});
