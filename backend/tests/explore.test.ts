import { describe, expect, it, afterAll } from "bun:test";
import { inArray } from "drizzle-orm";
import { db } from "@/config/db";
import { projects } from "@/db/schema/projects";
import { projectCollaborators, users } from "@/db/schema/auth";
import { DEFAULT_ROLE } from "@/constants/roles";
import { exploreRoutes } from "@/routes/explore";

// Integration test for the public explore endpoints (no auth required).
// Runs against the same DB as the rest of the suite. Every row created here
// carries a unique timestamp suffix and is removed in afterAll (best effort).
const suffix = Date.now().toString(36);
const createdProjectIds: string[] = [];
const createdUserIds: string[] = [];
const createdCollaboratorIds: string[] = [];

async function createProjectRow(name: string, isPublic: boolean): Promise<string> {
  const [row] = await db
    .insert(projects)
    .values({ name, isPublic, encryptionKeyEncrypted: "explore-test-key" })
    .returning({ id: projects.id });
  createdProjectIds.push(row.id);
  return row.id;
}

async function createUserRow(email: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: "explore-test-hash" })
    .returning({ id: users.id });
  createdUserIds.push(row.id);
  return row.id;
}

afterAll(async () => {
  try {
    if (createdCollaboratorIds.length > 0) {
      await db.delete(projectCollaborators).where(inArray(projectCollaborators.id, createdCollaboratorIds));
    }
    if (createdProjectIds.length > 0) {
      await db.delete(projects).where(inArray(projects.id, createdProjectIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
  } catch {
    // best effort cleanup, rows are namespaced by suffix so leftovers are harmless
  }
});

describe("GET /explore/projects", () => {
  it("lists only public projects without auth", async () => {
    const pub = await createProjectRow(`explore-pub-${suffix}`, true);
    const priv = await createProjectRow(`explore-priv-${suffix}`, false);

    const res = await exploreRoutes.request("/projects");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string; isPublic: boolean }[] };
    expect(body.data.every((p) => p.isPublic)).toBe(true);

    const ids = body.data.map((p) => p.id);
    expect(ids).toContain(pub);
    expect(ids).not.toContain(priv);
  });
});

describe("GET /explore/users/:email", () => {
  it("returns 404 NOT_FOUND for an unknown email", async () => {
    const res = await exploreRoutes.request(`/users/nobody-${suffix}@sigit.test`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns the profile with only that user's accessible public projects", async () => {
    const email = `explore-user-${suffix}@sigit.test`;
    const userId = await createUserRow(email);
    const owned = await createProjectRow(`explore-owned-${suffix}`, true);
    const other = await createProjectRow(`explore-other-${suffix}`, true);

    // Collaborator row: grants access to `owned` only.
    const [collab] = await db
      .insert(projectCollaborators)
      .values({ projectId: owned, userId })
      .returning({ id: projectCollaborators.id });
    createdCollaboratorIds.push(collab.id);

    const res = await exploreRoutes.request(`/users/${encodeURIComponent(email)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { email: string; role: string; projects: { id: string; isPublic: boolean }[] };
    };
    expect(body.data.email).toBe(email);
    expect(body.data.role).toBe(DEFAULT_ROLE);
    expect(body.data.projects.every((p) => p.isPublic)).toBe(true);

    const ids = body.data.projects.map((p) => p.id);
    expect(ids).toContain(owned);
    expect(ids).not.toContain(other);
  });
});
