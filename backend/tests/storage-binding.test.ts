// Paired test for modules/projects/storage-binding.ts: which storage
// connection a caller may bind a project to, plus the route that used to accept
// any id. Cases run against the dev database; rows carry a unique suffix and are
// removed in afterAll.
import { describe, expect, it, afterAll } from "bun:test";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/config/db";
import { projects } from "@/db/schema/projects";
import { storageConnections } from "@/db/schema/storage";
import { projectCollaborators, users } from "@/db/schema/auth";
import { ADMIN_ROLE, DEFAULT_ROLE } from "@/constants/roles";
import { SESSION_COOKIE } from "@/constants/protocol";
import { encryptSecret } from "@/lib/secret-encryption";
import { HttpError, errorResponse } from "@/lib/http-error";
import { createSession, hashPassword } from "@/modules/auth/auth";
import { assertConnectionBindable } from "@/modules/projects/storage-binding";
import { projectRepoPath } from "@/modules/projects/projects";
import { projectRoutes } from "@/routes/projects";

// A route mounted on its own has no global onError, so a thrown HttpError would
// come back as a 500 here. Install the same mapping the app registers in
// index.ts, so the assertions below see what a real client sees.
projectRoutes.onError((err, c) => errorResponse(c, err));

const suffix = Date.now().toString(36);
const createdUserIds: string[] = [];
const createdProjectIds: string[] = [];
const createdConnectionIds: string[] = [];

function cookie(token: string): Headers {
  return new Headers({ Cookie: `${SESSION_COOKIE}=${token}`, "Content-Type": "application/json" });
}

// Await a call that is expected to be refused, returning the HttpError (or null
// when it was not refused). Written with try/catch on purpose: the promise
// matchers for a rejected promise hang with this runtime, even though the call
// itself is a plain drizzle read (see AGENTS.md troubleshooting).
async function refusal(promise: Promise<unknown>): Promise<HttpError | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    return err as HttpError;
  }
}

async function createUser(email: string, role: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword("audit-password-123"), role })
    .returning({ id: users.id });
  createdUserIds.push(row.id);
  return row.id;
}

async function createConnection(): Promise<string> {
  const wrapped = encryptSecret("minioadmin");
  const [row] = await db
    .insert(storageConnections)
    .values({
      name: `binding-conn-${suffix}-${createdConnectionIds.length}`,
      endpoint: "http://127.0.0.1:9000",
      region: "us-east-1",
      accessKeyId: "minioadmin",
      secretEncrypted: wrapped.ciphertext,
      encryptionKeyId: wrapped.keyId,
      bucket: "sigit-test",
      forcePathStyle: true,
    })
    .returning({ id: storageConnections.id });
  createdConnectionIds.push(row.id);
  return row.id;
}

// Inserts a project row directly: the binding rules are what is under test, not
// the create route (which is covered separately below).
async function createProject(name: string, connectionId: string | null): Promise<string> {
  const [row] = await db
    .insert(projects)
    .values({ name, storageConnectionId: connectionId, encryptionKeyEncrypted: "binding-test-key" })
    .returning({ id: projects.id });
  createdProjectIds.push(row.id);
  return row.id;
}

afterAll(async () => {
  try {
    for (const id of createdProjectIds) {
      await db.delete(projectCollaborators).where(eq(projectCollaborators.projectId, id));
      await db.delete(projects).where(eq(projects.id, id));
      await fs.rm(projectRepoPath(id), { recursive: true, force: true }).catch(() => {});
    }
    for (const id of createdConnectionIds) {
      await db.delete(storageConnections).where(eq(storageConnections.id, id));
    }
    for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
  } catch {
    // best effort cleanup, rows are namespaced by suffix
  }
});

describe("assertConnectionBindable", () => {
  it("refuses an unknown connection id", async () => {
    const adminId = await createUser(`bind-unknown-${suffix}@local.test`, ADMIN_ROLE);
    const err = await refusal(assertConnectionBindable({ id: adminId, role: ADMIN_ROLE }, randomUUID()));
    expect(err?.status).toBe(400);
    expect(err?.code).toBe("BAD_REQUEST");
  });

  it("lets an admin bind any connection", async () => {
    const connectionId = await createConnection();
    const adminId = await createUser(`bind-admin-${suffix}@local.test`, ADMIN_ROLE);
    expect(await refusal(assertConnectionBindable({ id: adminId, role: ADMIN_ROLE }, connectionId))).toBeNull();
  });

  it("refuses a connection no project uses", async () => {
    const connectionId = await createConnection();
    const collabId = await createUser(`bind-unused-${suffix}@local.test`, DEFAULT_ROLE);
    const err = await refusal(assertConnectionBindable({ id: collabId, role: DEFAULT_ROLE }, connectionId));
    expect(err?.status).toBe(403);
    expect(err?.code).toBe("FORBIDDEN");
  });

  it("refuses a collaborator who cannot reach any project on that connection", async () => {
    const connectionId = await createConnection();
    // One project on the connection the collaborator cannot reach, and one
    // project they do collaborate on (so they are not simply a stranger).
    await createProject(`bind-owner-${suffix}`, connectionId);
    const otherProjectId = await createProject(`bind-other-${suffix}`, null);
    const collabId = await createUser(`bind-outsider-${suffix}@local.test`, DEFAULT_ROLE);
    await db.insert(projectCollaborators).values({ projectId: otherProjectId, userId: collabId, permissions: ["push"] });

    const err = await refusal(assertConnectionBindable({ id: collabId, role: DEFAULT_ROLE }, connectionId));
    expect(err?.status).toBe(403);
  });

  it("refuses a collaborator row that grants no permissions", async () => {
    const connectionId = await createConnection();
    const projectId = await createProject(`bind-empty-${suffix}`, connectionId);
    const actorId = await createUser(`bind-empty-actor-${suffix}@local.test`, DEFAULT_ROLE);
    // A row whose permission set normalizes to nothing is not access: row
    // presence alone must not let the actor bind a project to this connection.
    await db.insert(projectCollaborators).values({ projectId, userId: actorId, permissions: [] });

    const err = await refusal(assertConnectionBindable({ id: actorId, role: DEFAULT_ROLE }, connectionId));
    expect(err?.status).toBe(403);
  });

  it("lets a collaborator reuse a connection that backs a project they can reach", async () => {
    const connectionId = await createConnection();
    const sharedProjectId = await createProject(`bind-shared-${suffix}`, connectionId);
    const collabId = await createUser(`bind-insider-${suffix}@local.test`, DEFAULT_ROLE);
    await db.insert(projectCollaborators).values({ projectId: sharedProjectId, userId: collabId, permissions: ["view"] });

    expect(await refusal(assertConnectionBindable({ id: collabId, role: DEFAULT_ROLE }, connectionId))).toBeNull();
  });
});

describe("POST /projects storage binding", () => {
  it("refuses a collaborator binding a connection they cannot reach", async () => {
    const connectionId = await createConnection();
    const collabId = await createUser(`bind-route-collab-${suffix}@local.test`, DEFAULT_ROLE);
    const session = await createSession(collabId);
    const name = `bind-route-a-${suffix}`;

    const res = await projectRoutes.fetch(
      new Request("http://localhost/", {
        method: "POST",
        headers: cookie(session.token),
        body: JSON.stringify({ name, storageConnectionId: connectionId }),
      })
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN");

    // Nothing was persisted for the refused attempt.
    const row = await db.query.projects.findFirst({ where: eq(projects.name, name), columns: { id: true } });
    expect(row ?? null).toBeNull();
  });

  it("keeps the storage binding out of a collaborator's project response", async () => {
    const connectionId = await createConnection();
    const projectId = await createProject(`bind-hide-${suffix}`, connectionId);
    const collaboratorId = await createUser(`bind-hide-collab-${suffix}@local.test`, DEFAULT_ROLE);
    await db.insert(projectCollaborators).values({ projectId, userId: collaboratorId, permissions: ["view"] });
    const collaboratorSession = await createSession(collaboratorId);

    const seenByCollaborator = await projectRoutes.fetch(
      new Request(`http://localhost/${projectId}`, { headers: cookie(collaboratorSession.token) })
    );
    expect(seenByCollaborator.status).toBe(200);
    const collaboratorBody = (await seenByCollaborator.json()) as { data: Record<string, unknown> };
    // The handle of an admin-managed resource is operator surface.
    expect(Object.prototype.hasOwnProperty.call(collaboratorBody.data, "storageConnectionId")).toBe(false);
    // The LFS fields stay: the project page renders them for signed-in viewers.
    expect(Object.prototype.hasOwnProperty.call(collaboratorBody.data, "lfsSizeThreshold")).toBe(true);

    const adminId = await createUser(`bind-hide-admin-${suffix}@local.test`, ADMIN_ROLE);
    const adminSession = await createSession(adminId);
    const seenByAdmin = await projectRoutes.fetch(
      new Request(`http://localhost/${projectId}`, { headers: cookie(adminSession.token) })
    );
    const adminBody = (await seenByAdmin.json()) as { data: { storageConnectionId?: string } };
    expect(adminBody.data.storageConnectionId).toBe(connectionId);
  });

  it("still lets an admin create a project with a connection", async () => {
    const connectionId = await createConnection();
    const adminId = await createUser(`bind-route-admin-${suffix}@local.test`, ADMIN_ROLE);
    const session = await createSession(adminId);

    const res = await projectRoutes.fetch(
      new Request("http://localhost/", {
        method: "POST",
        headers: cookie(session.token),
        body: JSON.stringify({ name: `bind-route-b-${suffix}`, storageConnectionId: connectionId }),
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string; storageConnectionId: string } };
    createdProjectIds.push(body.data.id);
    expect(body.data.storageConnectionId).toBe(connectionId);
  });
});
