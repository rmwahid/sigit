// Paired test for the collaborator scoping fix (audit 2026-09-11, finding 4).
// Collaborator rows are per (project, user): mutating one project must never
// touch the same user's membership in another project.
import { describe, expect, it, afterAll } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db } from "@/config/db";
import { projects } from "@/db/schema/projects";
import { projectCollaborators, users } from "@/db/schema/auth";
import { ADMIN_ROLE, DEFAULT_ROLE } from "@/constants/roles";
import { SESSION_COOKIE } from "@/constants/protocol";
import { createSession, hashPassword } from "@/modules/auth/auth";
import { projectRoutes } from "@/routes/projects";

const suffix = Date.now().toString(36);
const createdUserIds: string[] = [];
const createdProjectIds: string[] = [];

function cookie(token: string): Headers {
  return new Headers({ Cookie: `${SESSION_COOKIE}=${token}`, "Content-Type": "application/json" });
}

async function createUser(email: string, role: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword("audit-password-123"), role })
    .returning({ id: users.id });
  createdUserIds.push(row.id);
  return row.id;
}

async function createProject(name: string): Promise<string> {
  const [row] = await db
    .insert(projects)
    .values({ name, encryptionKeyEncrypted: "collab-scope-key" })
    .returning({ id: projects.id });
  createdProjectIds.push(row.id);
  return row.id;
}

async function permissionsFor(projectId: string, userId: string): Promise<string[] | null> {
  const row = await db.query.projectCollaborators.findFirst({
    where: and(eq(projectCollaborators.projectId, projectId), eq(projectCollaborators.userId, userId)),
    columns: { permissions: true },
  });
  return row?.permissions ?? null;
}

afterAll(async () => {
  try {
    for (const id of createdProjectIds) await db.delete(projects).where(eq(projects.id, id));
    for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
  } catch {
    // best effort cleanup, rows are namespaced by suffix
  }
});

describe("collaborator mutations are project-scoped", () => {
  it("adding a collaborator in one project keeps memberships in other projects", async () => {
    const adminId = await createUser(`collab-admin-${suffix}@local.test`, ADMIN_ROLE);
    const { token } = await createSession(adminId);
    const headers = cookie(token);
    const memberId = await createUser(`collab-member-${suffix}@local.test`, DEFAULT_ROLE);
    const projectA = await createProject(`collab-a-${suffix}`);
    const projectB = await createProject(`collab-b-${suffix}`);

    // Grant on B directly, then upsert on A through the API.
    await db.insert(projectCollaborators).values({ projectId: projectB, userId: memberId, permissions: ["view"] });
    const addA = await projectRoutes.fetch(
      new Request(`http://localhost/${projectA}/collaborators`, {
        method: "POST",
        headers,
        body: JSON.stringify({ userId: memberId, permissions: ["view"] }),
      })
    );
    expect(addA.status).toBe(201);

    // Both memberships exist: the A upsert must not delete the B row.
    expect(await permissionsFor(projectA, memberId)).toEqual(["view"]);
    expect(await permissionsFor(projectB, memberId)).toEqual(["view"]);
  });

  it("updating permissions in one project does not change the other project", async () => {
    const adminId = await createUser(`collab-admin2-${suffix}@local.test`, ADMIN_ROLE);
    const { token } = await createSession(adminId);
    const headers = cookie(token);
    const memberId = await createUser(`collab-member2-${suffix}@local.test`, DEFAULT_ROLE);
    const projectA = await createProject(`collab-c-${suffix}`);
    const projectB = await createProject(`collab-d-${suffix}`);
    await db.insert(projectCollaborators).values([
      { projectId: projectA, userId: memberId, permissions: ["view"] },
      { projectId: projectB, userId: memberId, permissions: ["view"] },
    ]);

    const patch = await projectRoutes.fetch(
      new Request(`http://localhost/${projectA}/collaborators/${memberId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ permissions: ["push"] }),
      })
    );
    expect(patch.status).toBe(200);
    expect(await permissionsFor(projectA, memberId)).toContain("push");
    // B must be untouched (the previous behaviour leaked push here).
    expect(await permissionsFor(projectB, memberId)).toEqual(["view"]);
  });

  it("removing a collaborator from one project keeps the other membership", async () => {
    const adminId = await createUser(`collab-admin3-${suffix}@local.test`, ADMIN_ROLE);
    const { token } = await createSession(adminId);
    const headers = cookie(token);
    const memberId = await createUser(`collab-member3-${suffix}@local.test`, DEFAULT_ROLE);
    const projectA = await createProject(`collab-e-${suffix}`);
    const projectB = await createProject(`collab-f-${suffix}`);
    await db.insert(projectCollaborators).values([
      { projectId: projectA, userId: memberId, permissions: ["view"] },
      { projectId: projectB, userId: memberId, permissions: ["view"] },
    ]);

    const del = await projectRoutes.fetch(
      new Request(`http://localhost/${projectA}/collaborators/${memberId}`, { method: "DELETE", headers })
    );
    expect(del.status).toBe(200);
    expect(await permissionsFor(projectA, memberId)).toBeNull();
    expect(await permissionsFor(projectB, memberId)).toEqual(["view"]);
  });

  it("returns 404 when the user is not a collaborator of that project", async () => {
    const adminId = await createUser(`collab-admin4-${suffix}@local.test`, ADMIN_ROLE);
    const { token } = await createSession(adminId);
    const headers = cookie(token);
    const strangerId = await createUser(`collab-stranger-${suffix}@local.test`, DEFAULT_ROLE);
    const projectA = await createProject(`collab-g-${suffix}`);

    const patch = await projectRoutes.fetch(
      new Request(`http://localhost/${projectA}/collaborators/${strangerId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ permissions: ["push"] }),
      })
    );
    expect(patch.status).toBe(404);

    const del = await projectRoutes.fetch(
      new Request(`http://localhost/${projectA}/collaborators/${strangerId}`, { method: "DELETE", headers })
    );
    expect(del.status).toBe(404);
    expect(await permissionsFor(projectA, strangerId)).toBeNull();
  });
});
