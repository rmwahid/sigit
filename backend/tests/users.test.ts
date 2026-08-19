import { afterAll, describe, expect, it } from "bun:test";
import { db } from "@/config/db";
import { users } from "@/db/schema/auth";
import { createSession } from "@/modules/auth/auth";
import { deleteUser, listUsers } from "@/modules/auth/auth";
import { userRoutes } from "@/routes/users";
import { SESSION_COOKIE } from "@/constants/protocol";
import { ADMIN_ROLE } from "@/constants/roles";

// Integration test for the admin user routes (list / reset-password / delete)
// against dev DB `sigit`. Every created row carries a unique suffix and is
// removed in afterAll.
const suffix = Date.now().toString(36);
const createdUserIds: string[] = [];

async function createUserRow(email: string, role = "collaborator") {
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: "users-test-hash", role })
    .returning({ id: users.id });
  createdUserIds.push(row.id);
  return row;
}

function cookie(token: string): Headers {
  return new Headers({ Cookie: `${SESSION_COOKIE}=${token}` });
}

async function adminToken(): Promise<string> {
  const all = await db.select().from(users);
  const admin = all.find((u) => u.role === ADMIN_ROLE);
  if (!admin) throw new Error("No admin user in dev DB");
  return (await createSession(admin.id)).token;
}

afterAll(async () => {
  for (const id of createdUserIds) {
    await deleteUser(id).catch(() => {});
  }
});

describe("user routes (admin)", () => {
  it("lists users only for an admin session", async () => {
    const token = await adminToken();
    const res = await userRoutes.request("/", { headers: cookie(token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { email: string }[] };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("rejects anonymous requests with 403 (admin-only route)", async () => {
    const res = await userRoutes.request("/");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN");
  });

  it("resets a user password", async () => {
    const token = await adminToken();
    const { id } = await createUserRow(`users-reset-${suffix}@sigit.test`);
    const res = await userRoutes.request(`/${id}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `${SESSION_COOKIE}=${token}` },
      body: JSON.stringify({ password: "new-password-123" }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 404 when resetting a missing user", async () => {
    const token = await adminToken();
    const res = await userRoutes.request("/00000000-0000-4000-8000-000000000000/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `${SESSION_COOKIE}=${token}` },
      body: JSON.stringify({ password: "new-password-123" }),
    });
    expect(res.status).toBe(404);
  });

  it("deletes a collaborator user", async () => {
    const token = await adminToken();
    const { id } = await createUserRow(`users-del-${suffix}@sigit.test`);
    createdUserIds.splice(createdUserIds.indexOf(id), 1);
    const res = await userRoutes.request(`/${id}`, { method: "DELETE", headers: cookie(token) });
    expect(res.status).toBe(200);
    expect(await listUsers()).not.toContainEqual(expect.objectContaining({ id }));
  });
});
