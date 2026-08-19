import { describe, expect, it, afterAll } from "bun:test";
import { db } from "@/config/db";
import { decryptSecret } from "@/lib/secret-encryption";
import { storageConnections, type NewStorageConnection } from "@/db/schema/storage";
import {
  createConnection,
  createConnectionFromInput,
  deleteConnection,
  getConnection,
  listConnections,
  updateConnection,
  type StorageConnectionInput,
} from "@/modules/storage/connections";

// Storage connection module: pure path via an injected fake insert client,
// DB path via the real dev DB with unique names + cleanup.
const TEST_TIMEOUT = 30000;
const suffix = Date.now().toString(36);
const createdIds: string[] = [];

function input(name: string, overrides: Partial<StorageConnectionInput> = {}): StorageConnectionInput {
  return {
    name,
    endpoint: "http://127.0.0.1:9000",
    region: "us-east-1",
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
    bucket: "sigit-test",
    ...overrides,
  };
}

async function cleanup() {
  for (const id of createdIds) {
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

describe("createConnectionFromInput (injected client, pure)", () => {
  it("encrypts the secret and maps the input fields", async () => {
    const captured: { values: NewStorageConnection }[] = [];
    const fake = {
      insert: () => ({
        values: (v: NewStorageConnection) => {
          captured.push({ values: v });
          return { returning: async () => [{ ...v, id: "conn-fake", createdAt: new Date(), updatedAt: new Date() }] };
        },
      }),
    };

    const connection = await createConnectionFromInput(input(`fake-${suffix}`), fake as never);
    expect(connection.id).toBe("conn-fake");
    expect(captured).toHaveLength(1);

    const v = captured[0].values;
    expect(v.name).toBe(`fake-${suffix}`);
    expect(v.accessKeyId).toBe("minioadmin");
    // The raw secret never reaches the DB - only the AES-256-GCM ciphertext.
    expect(v.secretEncrypted).not.toBe("minioadmin");
    expect(v.secretEncrypted).not.toContain("minioadmin");
    expect(decryptSecret({ ciphertext: v.secretEncrypted, keyId: v.encryptionKeyId })).toBe("minioadmin");
    expect(v.forcePathStyle).toBe(true);
  });

  it("keeps forcePathStyle false when explicitly requested", async () => {
    const fake = {
      insert: () => ({
        values: (v: NewStorageConnection) => ({
          returning: async () => [{ ...v, id: "conn-fake-2", createdAt: new Date(), updatedAt: new Date() }],
        }),
      }),
    };
    const connection = await createConnectionFromInput(
      input(`fake-fps-${suffix}`, { forcePathStyle: false }),
      fake as never
    );
    expect(connection.forcePathStyle).toBe(false);
  });

  it("throws when the insert returns no rows", async () => {
    const fake = { insert: () => ({ values: () => ({ returning: async () => [] }) }) };
    let message = "";
    try {
      await createConnectionFromInput(input(`fake-empty-${suffix}`), fake as never);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toBe("Failed to create connection");
  });
});

describe("storage connections (real DB)", () => {
  it("creates, lists, reads, updates, and deletes a connection", async () => {
    const created = await createConnectionFromInput(input(`conn-${suffix}`));
    createdIds.push(created.id);

    expect((await listConnections()).some((c) => c.id === created.id)).toBe(true);

    const fetched = await getConnection(created.id);
    expect(fetched?.name).toBe(`conn-${suffix}`);
    expect(fetched?.secretEncrypted).not.toBe("minioadmin");

    const updated = await updateConnection(created.id, { name: `conn-renamed-${suffix}` });
    expect(updated?.name).toBe(`conn-renamed-${suffix}`);
    expect((await getConnection(created.id))?.name).toBe(`conn-renamed-${suffix}`);

    expect(await deleteConnection(created.id)).toBe(true);
    createdIds.pop();
    expect(await getConnection(created.id)).toBeUndefined();
    expect(await deleteConnection(created.id)).toBe(false);
  });

  it("createConnection (raw values) inserts and returns a row", async () => {
    const created = await createConnection({
      name: `conn-raw-${suffix}`,
      endpoint: "http://127.0.0.1:9000",
      region: "us-east-1",
      accessKeyId: "minioadmin",
      secretEncrypted: "cipher",
      bucket: "sigit-test",
    });
    createdIds.push(created.id);

    const rows = await db.select().from(storageConnections);
    const row = rows.find((r) => r.id === created.id);
    expect(row?.secretEncrypted).toBe("cipher");
    expect(row?.provider).toBe("s3");
  });
});
