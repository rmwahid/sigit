// Paired test for the storage route authorization fix (audit 2026-09-11,
// finding 5). The storage surface is admin-only: a collaborator must not be
// able to enumerate connections, list bucket objects across projects, or
// delete another project's objects.
import { describe, expect, it, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/config/db";
import { projects } from "@/db/schema/projects";
import { projectCollaborators, users } from "@/db/schema/auth";
import { ADMIN_ROLE, DEFAULT_ROLE } from "@/constants/roles";
import { SESSION_COOKIE } from "@/constants/protocol";
import { createSession, hashPassword } from "@/modules/auth/auth";
import { storageRoutes } from "@/routes/storage";

const suffix = Date.now().toString(36);
const createdUserIds: string[] = [];
const createdProjectIds: string[] = [];

async function createUser(email: string, role: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword("audit-password-123"), role })
    .returning({ id: users.id });
  createdUserIds.push(row.id);
  return row.id;
}

function cookie(token: string): Headers {
  return new Headers({ Cookie: `${SESSION_COOKIE}=${token}` });
}

afterAll(async () => {
  try {
    for (const id of createdProjectIds) await db.delete(projects).where(eq(projects.id, id));
    for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
  } catch {
    // best effort cleanup, rows are namespaced by suffix
  }
});

describe("storage routes are admin-only", () => {
  it("rejects an anonymous caller with 403 on every endpoint", async () => {
    const paths: [string, string][] = [
      ["GET", "/connections"],
      ["POST", "/connections"],
      ["GET", "/connections/00000000-0000-4000-8000-000000000000"],
      ["PATCH", "/connections/00000000-0000-4000-8000-000000000000"],
      ["DELETE", "/connections/00000000-0000-4000-8000-000000000000"],
      ["POST", "/connections/00000000-0000-4000-8000-000000000000/test"],
      ["GET", "/connections/00000000-0000-4000-8000-000000000000/objects"],
      ["DELETE", `/connections/00000000-0000-4000-8000-000000000000/objects/${encodeURIComponent("projects/x/backup.bundle")}`],
    ];
    for (const [method, path] of paths) {
      const res = await storageRoutes.fetch(new Request(`http://localhost${path}`, { method }));
      expect(res.status).toBe(403);
    }
  });

  it("rejects a collaborator with 403 (no bucket access, no object deletion)", async () => {
    const userId = await createUser(`storage-collab-${suffix}@local.test`, DEFAULT_ROLE);
    const { token } = await createSession(userId);
    const headers = cookie(token);

    // A project the collaborator may read, and the connection-scoped calls.
    const [project] = await db
      .insert(projects)
      .values({ name: `storage-collab-proj-${suffix}`, encryptionKeyEncrypted: "x" })
      .returning({ id: projects.id });
    createdProjectIds.push(project.id);
    await db.insert(projectCollaborators).values({ projectId: project.id, userId, permissions: ["clone", "view"] });

    const paths: [string, string][] = [
      ["GET", "/connections"],
      ["GET", "/connections/00000000-0000-4000-8000-000000000000/objects"],
      ["DELETE", `/connections/00000000-0000-4000-8000-000000000000/objects/${encodeURIComponent(`projects/${project.id}/backup.bundle`)}`],
      ["GET", `/connections/00000000-0000-4000-8000-000000000000/objects?prefix=projects/${project.id}/`],
    ];
    for (const [method, path] of paths) {
      const res = await storageRoutes.fetch(new Request(`http://localhost${path}`, { method, headers }));
      expect(res.status).toBe(403);
    }
  });

  it("admins still reach the routes (404 for an unknown connection, not 403)", async () => {
    const adminId = await createUser(`storage-admin-${suffix}@local.test`, ADMIN_ROLE);
    const { token } = await createSession(adminId);
    const headers = cookie(token);

    const missing = "00000000-0000-4000-8000-000000000000";
    const list = await storageRoutes.fetch(new Request("http://localhost/connections", { headers }));
    expect(list.status).toBe(200);

    const detail = await storageRoutes.fetch(
      new Request(`http://localhost/connections/${missing}`, { headers })
    );
    expect(detail.status).toBe(404);

    const objects = await storageRoutes.fetch(
      new Request(`http://localhost/connections/${missing}/objects`, { headers })
    );
    expect(objects.status).toBe(404);
  });
});
