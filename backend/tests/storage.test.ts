import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/config/db";
import { users } from "@/db/schema/auth";
import { ADMIN_ROLE } from "@/constants/roles";
import { SESSION_COOKIE } from "@/constants/protocol";
import { createSession, hashPassword } from "@/modules/auth/auth";
import { deleteConnection, getConnection } from "@/modules/storage/connections";
import { storageRoutes } from "@/routes/storage";

// Integration test for the storage connection web routes (create/list/get/
// update/delete) against dev DB `sigit`. S3-dependent routes (connection test,
// object list/delete) are not exercised here - they are covered by
// objects.test.ts and projects.test.ts against local MinIO.
//
// The whole storage surface is admin-only (audit 2026-09-11), so every request
// carries an admin session cookie; tests/storage-authz.test.ts covers the
// rejection paths for anonymous and collaborator callers.
const suffix = Date.now().toString(36);
const createdConnectionIds: string[] = [];
let adminHeaders: Headers;
let adminUserId: string | null = null;

function input(name: string) {
  return {
    name,
    endpoint: "http://127.0.0.1:9000",
    region: "us-east-1",
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin-secret-1234",
    bucket: "sigit-test",
    forcePathStyle: true,
  };
}

type CreatedConnection = { id: string; name: string; secretMasked: string; hasSecret: boolean };

async function postConnection(name: string) {
  const res = await storageRoutes.request("/connections", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify(input(name)),
  });
  const body = (await res.json()) as { data: CreatedConnection };
  createdConnectionIds.push(body.data.id);
  return { res, body };
}

beforeAll(async () => {
  const email = `storage-route-admin-${suffix}@local.test`;
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword("storage-test-password"), role: ADMIN_ROLE })
    .returning({ id: users.id });
  adminUserId = row.id;
  const { token } = await createSession(row.id);
  adminHeaders = new Headers({ Cookie: `${SESSION_COOKIE}=${token}`, "Content-Type": "application/json" });
});

afterAll(async () => {
  for (const id of createdConnectionIds) {
    await deleteConnection(id).catch(() => {});
  }
  if (adminUserId) await db.delete(users).where(eq(users.id, adminUserId)).catch(() => {});
});

describe("storage connection routes", () => {
  it("creates a connection and masks the secret", async () => {
    const { res, body } = await postConnection(`storage-route-${suffix}`);
    expect(res.status).toBe(201);
    const data = body.data;
    expect(data.name).toBe(`storage-route-${suffix}`);
    expect(data.hasSecret).toBe(true);
    // maskSecret keeps first 4 + last 4 chars; the raw secret never leaves the API.
    expect(data.secretMasked).toBe("mini***1234");
    expect(data.secretMasked).not.toContain("minioadmin-secret");
  });

  it("lists connections with masked secrets only", async () => {
    const name = `storage-list-${suffix}`;
    await postConnection(name);

    const list = await storageRoutes.request("/connections", { headers: adminHeaders });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { data: { name: string; secretMasked: string }[] };
    const row = body.data.find((c) => c.name === name);
    expect(row).toBeDefined();
    expect(row?.secretMasked).toBe("mini***1234");
  });

  it("returns 404 for a missing connection", async () => {
    const res = await storageRoutes.request("/connections/00000000-0000-4000-8000-000000000000", {
      headers: adminHeaders,
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("updates a connection name", async () => {
    const { body } = await postConnection(`storage-update-${suffix}`);
    const id = body.data.id;
    const renamed = `storage-renamed-${suffix}`;

    const patch = await storageRoutes.request(`/connections/${id}`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ name: renamed }),
    });
    expect(patch.status).toBe(200);
    const data = ((await patch.json()) as { data: { name: string } }).data;
    expect(data.name).toBe(renamed);
    expect((await getConnection(id))?.name).toBe(renamed);
  });

  it("deletes a connection and returns its id", async () => {
    const { res, body } = await postConnection(`storage-delete-${suffix}`);
    const id = body.data.id;
    createdConnectionIds.splice(createdConnectionIds.indexOf(id), 1);

    const del = await storageRoutes.request(`/connections/${id}`, { method: "DELETE", headers: adminHeaders });
    expect(del.status).toBe(200);
    expect(((await del.json()) as { data: { id: string } }).data.id).toBe(id);
    expect(await getConnection(id)).toBeUndefined();
  });
});
