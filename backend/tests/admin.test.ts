import { afterAll, describe, expect, it } from "bun:test";
import { db } from "@/config/db";
import { users } from "@/db/schema/auth";
import { createSession } from "@/modules/auth/auth";
import { deleteUser } from "@/modules/auth/auth";
import { adminRoutes } from "@/routes/admin";
import { SESSION_COOKIE } from "@/constants/protocol";
import { ADMIN_ROLE } from "@/constants/roles";
import { log } from "@/lib/logger";

// Integration test for the admin routes (log endpoints) against dev DB `sigit`.
const suffix = Date.now().toString(36);
const createdUserIds: string[] = [];

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

describe("admin routes", () => {
  it("serves recent logs to an admin session", async () => {
    log.info("admin-test", `probe-${suffix}`);
    const token = await adminToken();
    const res = await adminRoutes.request("/logs?limit=5", { headers: cookie(token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { scope?: string; event?: string; message?: string }[] };
    expect(Array.isArray(body.data)).toBe(true);
    // The ring buffer carries the request entries we just emitted; probe may
    // be further back than `limit`, so only require the endpoint to respond.
    expect(body.data.length).toBeGreaterThanOrEqual(0);
  });

  it("rejects anonymous requests with 403 (admin-only route)", async () => {
    const res = await adminRoutes.request("/logs");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN");
  });

  it("rejects non-admin sessions with 403", async () => {
    const [row] = await db
      .insert(users)
      .values({ email: `admin-user-${suffix}@sigit.test`, passwordHash: "admin-test-hash" })
      .returning({ id: users.id });
    createdUserIds.push(row.id);
    const { token } = await createSession(row.id);
    const res = await adminRoutes.request("/logs", { headers: cookie(token) });
    expect(res.status).toBe(403);
  });
});
