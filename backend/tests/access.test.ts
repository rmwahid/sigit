import { describe, expect, it, afterAll } from "bun:test";
import { ADMIN_ROLE, DEFAULT_ROLE } from "@/constants/roles";
import { eq } from "drizzle-orm";
import { db } from "@/config/db";
import { projectCollaborators, users } from "@/db/schema/auth";
import { createConnectionFromInput, deleteConnection } from "@/modules/storage/connections";
import { createProject, hardDeleteProject } from "@/modules/projects/projects";
import { createAdminUser, createUser, deleteUser, listUsers } from "@/modules/auth/auth";
import {
  getProjectAccess,
  hasPermission,
  isSiteAdmin,
  listAccessibleProjects,
  normalizePermissions,
  tokenScopeForUser,
  userCan,
} from "@/modules/auth/access";

// Access rules: dev DB `sigit` (no MinIO needed - no S3 ops in this file).
const TEST_TIMEOUT = 30000;

const suffix = Date.now().toString(36);
const createdProjectIds: string[] = [];
const createdConnectionIds: string[] = [];
const createdUserIds: string[] = [];

async function makeProject(name: string) {
  const connection = await createConnectionFromInput({
    name: `test-acc-conn-${name}-${suffix}`,
    endpoint: "http://127.0.0.1:9000",
    region: "us-east-1",
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
    bucket: "sigit-test",
    forcePathStyle: true,
  });
  createdConnectionIds.push(connection.id);
  const project = await createProject({ name, storageConnectionId: connection.id });
  createdProjectIds.push(project.id);
  return project;
}

async function makeUser(name: string) {
  const user = await createUser(`access-${name}-${suffix}@test.local`, "password123", DEFAULT_ROLE);
  createdUserIds.push(user.id);
  return user;
}

async function setCollaborator(projectId: string, userId: string, permissions: string[]) {
  await db.insert(projectCollaborators).values({ projectId, userId, permissions });
}

async function cleanup() {
  for (const id of createdProjectIds) {
    try {
      await hardDeleteProject(id);
    } catch {
      // best effort
    }
  }
  for (const id of createdUserIds) {
    try {
      await deleteUser(id);
    } catch {
      // best effort
    }
  }
  for (const id of createdConnectionIds) {
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

describe("normalizePermissions", () => {
  it("dedupes and filters unknown permissions", () => {
    expect(normalizePermissions(["clone", "clone", "view", "hack"])).toEqual(["clone", "view"]);
  });

  it("enforces push implies clone", () => {
    expect(normalizePermissions(["push"])).toContain("clone");
    expect(normalizePermissions(["push", "view"])).toEqual(expect.arrayContaining(["push", "clone", "view"]));
  });

  it("enforces lfsUpload implies lfsDownload", () => {
    expect(normalizePermissions(["lfsUpload"])).toContain("lfsDownload");
  });
});

describe("isSiteAdmin and hasPermission", () => {
  it("recognizes admin role", () => {
    expect(isSiteAdmin({ role: ADMIN_ROLE })).toBe(true);
    expect(isSiteAdmin({ role: DEFAULT_ROLE })).toBe(false);
  });

  it("null access means admin: everything allowed", () => {
    expect(hasPermission(null, "clone")).toBe(true);
    expect(hasPermission(null, "push")).toBe(true);
  });

  it("checks membership in the permission set", () => {
    const access = ["clone", "view"];
    expect(hasPermission(access, "clone")).toBe(true);
    expect(hasPermission(access, "push")).toBe(false);
  });
});

describe("tokenScopeForUser", () => {
  it("admin can request any scope", () => {
    expect(tokenScopeForUser(null, "read")).toBe(true);
    expect(tokenScopeForUser(null, "write")).toBe(true);
  });

  it("read scope needs clone, write scope needs push", () => {
    expect(tokenScopeForUser(["clone"], "read")).toBe(true);
    expect(tokenScopeForUser(["clone", "push"], "write")).toBe(true);
    expect(tokenScopeForUser(["clone"], "write")).toBe(false);
    expect(tokenScopeForUser(["view"], "read")).toBe(false);
  });
});

describe("project access (DB sigit)", () => {
  it("admin bypasses collaborators and sees every project", async () => {
    const admin = (await db.select().from(users).where(eq(users.role, ADMIN_ROLE)).limit(1))[0];
    expect(admin).toBeDefined();
    const project = await makeProject(`acc-admin-${suffix}`);

    expect(await getProjectAccess(admin!.id, project.id)).toBeNull();
    expect(await userCan(admin!.id, project.id, "push")).toBe(true);
    const all = await listAccessibleProjects(admin!.id);
    expect(all.some((p) => p.id === project.id)).toBe(true);
  });

  it("returns normalized permissions for a collaborator", async () => {
    const member = await makeUser("collab");
    const project = await makeProject(`acc-collab-${suffix}`);
    await setCollaborator(project.id, member.id, ["push", "view", "unknown"]);

    const access = await getProjectAccess(member.id, project.id);
    expect(access).toEqual(expect.arrayContaining(["push", "clone", "view"])); // push implies clone
    expect(access).not.toContain("unknown");
    expect(await userCan(member.id, project.id, "push")).toBe(true);
    expect(await userCan(member.id, project.id, "diff")).toBe(false);
  });

  it("returns empty access for a user without a collaborator row", async () => {
    const stranger = await makeUser("stranger");
    const project = await makeProject(`acc-stranger-${suffix}`);

    expect(await getProjectAccess(stranger.id, project.id)).toEqual([]);
    expect(await userCan(stranger.id, project.id, "clone")).toBe(false);
    const projects = await listAccessibleProjects(stranger.id);
    expect(projects.some((p) => p.id === project.id)).toBe(false);
  });

  it("lists only projects the member has access to", async () => {
    const member = await makeUser("listing");
    const mine = await makeProject(`acc-mine-${suffix}`);
    const other = await makeProject(`acc-other-${suffix}`);
    await setCollaborator(mine.id, member.id, ["view"]);

    const projects = await listAccessibleProjects(member.id);
    expect(projects.some((p) => p.id === mine.id)).toBe(true);
    expect(projects.some((p) => p.id === other.id)).toBe(false);
  });
});

describe("user management (DB sigit)", () => {
  it("creates, lists and deletes a user (role is fixed at creation)", async () => {
    const created = await createUser(`mgmt-${suffix}@test.local`, "password123", DEFAULT_ROLE);
    createdUserIds.push(created.id);

    const listed = await listUsers();
    expect(listed.some((u) => u.id === created.id && u.role === DEFAULT_ROLE)).toBe(true);
    expect(listed[0]).not.toHaveProperty("passwordHash");

    // The only path to an admin account is createAdminUser (single admin
    // model: regular users can never be promoted).
    const admin = await createAdminUser(`mgmt-admin-${suffix}@test.local`, "password123");
    createdUserIds.push(admin.id);
    const after = await listUsers();
    expect(after.find((u) => u.id === admin.id)?.role).toBe(ADMIN_ROLE);
    expect(after.find((u) => u.id === created.id)?.role).toBe(DEFAULT_ROLE);

    await deleteUser(created.id);
    await deleteUser(admin.id);
    const final = await listUsers();
    expect(final.some((u) => u.id === created.id)).toBe(false);
    expect(final.some((u) => u.id === admin.id)).toBe(false);
  });
});
