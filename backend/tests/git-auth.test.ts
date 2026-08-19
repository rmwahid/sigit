import { describe, expect, it, afterAll } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "@/config/db";
import { projects } from "@/db/schema/projects";
import { projectCollaborators } from "@/db/schema/auth";
import { createConnectionFromInput, deleteConnection } from "@/modules/storage/connections";
import { createProject, hardDeleteProject } from "@/modules/projects/projects";
import { createUser, deleteUser } from "@/modules/auth/auth";
import { createToken, revokeToken, setTokenProjectScopes } from "@/modules/auth/tokens";
import { requireGitToken, type GitAuthEnv } from "@/middleware/git-auth";
import { BASIC_AUTH_PREFIX } from "@/constants/protocol";
import { DEFAULT_ROLE } from "@/constants/roles";

// Middleware auth for the git/LFS protocol: anonymous public clone, token
// validity, owner access and per-project token scope. Dev DB `sigit`, no S3
// operations (createProject only inserts rows, no object uploads happen).
const suffix = Date.now().toString(36);
const createdProjectIds: string[] = [];
const createdConnectionIds: string[] = [];
const createdUserIds: string[] = [];
const createdTokens: { id: string; userId: string }[] = [];

// Minimal router mounting the middleware exactly like routes/git.ts does.
const app = new Hono<GitAuthEnv>();
app.get("/projects/:name{.+\.git}/info/refs", requireGitToken, (c) => c.json({ ok: true }));
app.post("/projects/:name{.+\.git}/git-receive-pack", requireGitToken, (c) => c.json({ ok: true }));

async function makeProject(name: string, isPublic = false) {
  const connection = await createConnectionFromInput({
    name: `git-auth-conn-${name}-${suffix}`,
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
  if (isPublic) {
    await db.update(projects).set({ isPublic: true }).where(eq(projects.id, project.id));
  }
  return project;
}

async function makeUser(name: string) {
  const user = await createUser(`git-auth-${name}-${suffix}@test.local`, "password123", DEFAULT_ROLE);
  createdUserIds.push(user.id);
  return user;
}

async function makeToken(userId: string, projectId: string, scope: "read" | "write") {
  const { id, token } = await createToken(userId, `git-auth-tok-${suffix}`, new Date(Date.now() + 60 * 60 * 1000));
  createdTokens.push({ id, userId });
  await setTokenProjectScopes(id, [{ projectId, scope }]);
  return { id, raw: token };
}

function basicAuth(raw: string): Headers {
  const credentials = Buffer.from(`sigit:${raw}`).toString("base64");
  return new Headers({ Authorization: `${BASIC_AUTH_PREFIX}${credentials}` });
}

afterAll(async () => {
  for (const { id, userId } of createdTokens) {
    try {
      await revokeToken(id, userId);
    } catch {
      // best effort
    }
  }
  for (const id of createdProjectIds) {
    try {
      await hardDeleteProject(id);
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
  for (const id of createdUserIds) {
    try {
      await deleteUser(id);
    } catch {
      // best effort
    }
  }
});

describe("git protocol auth middleware", () => {
  it("rejects anonymous access to a private project (401)", async () => {
    const project = await makeProject(`priv-${suffix}`);
    const res = await app.request(`/projects/${project.name}.git/info/refs`);
    expect(res.status).toBe(401);
  });

  it("allows anonymous clone on a public project", async () => {
    const project = await makeProject(`pub-${suffix}`, true);
    const res = await app.request(`/projects/${project.name}.git/info/refs`);
    expect(res.status).toBe(200);
  });

  it("rejects an unknown token (401)", async () => {
    const project = await makeProject(`badtok-${suffix}`);
    const res = await app.request(`/projects/${project.name}.git/info/refs`, { headers: basicAuth("sigit_invalid") });
    expect(res.status).toBe(401);
  });

  it("rejects a token whose owner lost collaborator access (403)", async () => {
    const project = await makeProject(`noaccess-${suffix}`);
    const user = await makeUser("noaccess");
    const { raw } = await makeToken(user.id, project.id, "write");
    const res = await app.request(`/projects/${project.name}.git/info/refs`, { headers: basicAuth(raw) });
    expect(res.status).toBe(403);
  });

  it("rejects a token without a scope row for the project (403)", async () => {
    const project = await makeProject(`noscope-${suffix}`);
    const user = await makeUser("noscope");
    await db.insert(projectCollaborators).values({ projectId: project.id, userId: user.id, permissions: ["push"] });
    const { id, token } = await createToken(user.id, `git-auth-noscope-${suffix}`, new Date(Date.now() + 60 * 60 * 1000));
    createdTokens.push({ id, userId: user.id });
    const res = await app.request(`/projects/${project.name}.git/info/refs`, { headers: basicAuth(token) });
    expect(res.status).toBe(403);
  });

  it("rejects a read-scope token on push (403)", async () => {
    const project = await makeProject(`readonly-${suffix}`);
    const user = await makeUser("readonly");
    await db.insert(projectCollaborators).values({ projectId: project.id, userId: user.id, permissions: ["push"] });
    const { raw } = await makeToken(user.id, project.id, "read");
    const res = await app.request(`/projects/${project.name}.git/git-receive-pack`, {
      method: "POST",
      headers: basicAuth(raw),
    });
    expect(res.status).toBe(403);
  });

  it("allows a write-scope token with collaborator access (200)", async () => {
    const project = await makeProject(`ok-${suffix}`);
    const user = await makeUser("ok");
    await db.insert(projectCollaborators).values({ projectId: project.id, userId: user.id, permissions: ["push"] });
    const { raw } = await makeToken(user.id, project.id, "write");
    const res = await app.request(`/projects/${project.name}.git/git-receive-pack`, {
      method: "POST",
      headers: basicAuth(raw),
    });
    expect(res.status).toBe(200);
  });
});
