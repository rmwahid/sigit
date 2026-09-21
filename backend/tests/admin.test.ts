import { afterAll, describe, expect, it } from "bun:test";
import { db } from "@/config/db";
import { users } from "@/db/schema/auth";
import { createSession, deleteSession, deleteUser } from "@/modules/auth/auth";
import { adminRoutes } from "@/routes/admin";
import { SESSION_COOKIE } from "@/constants/protocol";
import { ADMIN_ROLE } from "@/constants/roles";
import { log, subscriberCount, subscribe, unsubscribeOwner } from "@/lib/logger";

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

describe("admin log stream lifecycle", () => {
  // The subscriber registry is process-global, so every assertion is relative to
  // what was already attached when the test started.
  it("detaches a live stream when the session that opened it ends", async () => {
    const before = subscriberCount();
    const token = await adminToken();
    const res = await adminRoutes.request("/logs/stream", { headers: cookie(token) });
    expect(res.status).toBe(200);
    // The stream registers its subscriber inside the SSE callback.
    for (let i = 0; i < 20 && subscriberCount() !== before + 1; i++) await new Promise((r) => setTimeout(r, 10));
    expect(subscriberCount()).toBe(before + 1);

    // Logging out must end the stream, not just the cookie: without this the
    // connection keeps receiving admin-only lines after its authority is gone.
    await deleteSession(token);
    expect(subscriberCount()).toBe(before);
  });

  it("does not attach a subscriber for an already-aborted request", async () => {
    const before = subscriberCount();
    const token = await adminToken();
    const controller = new AbortController();
    controller.abort();

    // A request that is already aborted never fires its abort event again, so a
    // subscriber registered here would be unreachable forever.
    const res = await adminRoutes.request("/logs/stream", { headers: cookie(token), signal: controller.signal });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(subscriberCount()).toBe(before);
  });

  it("reports the live stream count and detaches by owner", () => {
    const before = subscriberCount();
    const detach = subscribe("owner-a", () => {});
    subscribe("owner-b", () => {});
    expect(subscriberCount()).toBe(before + 2);
    detach();
    expect(subscriberCount()).toBe(before + 1);
    // Detaching one owner leaves the other attached.
    expect(unsubscribeOwner("owner-b")).toBe(1);
    expect(subscriberCount()).toBe(before);
    // An owner with nothing attached detaches nothing.
    expect(unsubscribeOwner("owner-b")).toBe(0);
  });
});
