import { describe, expect, it, afterAll } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/config/db";
import { users } from "@/db/schema/auth";
import { tokenCreateInput, tokenProjectSchema } from "@/routes/tokens";
import { MAX_TOKEN_PROJECTS } from "@/constants/limits";
import {
  createToken,
  listTokens,
  listTokensWithProjectScopes,
  resolveTokenScope,
  revokeToken,
  setTokenProjectScopes,
  validateToken,
} from "@/modules/auth/tokens";
import { createConnectionFromInput, deleteConnection } from "@/modules/storage/connections";
import { createProject, hardDeleteProject } from "@/modules/projects/projects";
import { createSession } from "@/modules/auth/auth";
import { SESSION_COOKIE } from "@/constants/protocol";
import { tokenRoutes } from "@/routes/tokens";

// Per-project token scopes: dev DB `sigit` (no MinIO, no S3 operations here).
const TEST_TIMEOUT = 30000;

const suffix = Date.now().toString(36);
const createdProjectIds: string[] = [];
const createdConnectionIds: string[] = [];
const createdTokenIds: string[] = [];
const createdUserIds: string[] = [];

async function adminUser() {
  const rows = await db.select().from(users).limit(1);
  return rows[0];
}

async function makeProject(name: string): Promise<{ projectId: string }> {
  const connection = await createConnectionFromInput({
    name: `test-conn-${name}-${suffix}`,
    endpoint: "http://127.0.0.1:9000",
    region: "us-east-1",
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
    bucket: "sigit-test",
    forcePathStyle: true,
  });
  createdConnectionIds.push(connection.id);
  const project = await createProject({
    name,
    storageConnectionId: connection.id,
  });
  createdProjectIds.push(project.id);
  return { projectId: project.id };
}

async function makeToken(name: string): Promise<{ tokenId: string; raw: string }> {
  const admin = await adminUser();
  if (!admin) throw new Error("no admin user in DB");
  const expires = new Date(Date.now() + 60 * 60 * 1000);
  const { id, token } = await createToken(admin.id, name, expires);
  createdTokenIds.push(id);
  return { tokenId: id, raw: token };
}

async function cleanup() {
  for (const id of createdTokenIds) {
    try {
      const admin = await adminUser();
      if (admin) await revokeToken(id, admin.id);
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
      await db.delete(users).where(eq(users.id, id));
    } catch {
      // best effort
    }
  }
}

afterAll(async () => {
  await cleanup();
}, TEST_TIMEOUT);

// Pure schema regression: the UI sends scope SLUGS ("read"/"write"), not the
// { slug, name } constant objects. z.enum(TOKEN_SCOPES) rejected slugs, which
// broke token creation with a 400 (caught by the bundle E2E suite).
describe("token create schema", () => {
  it("accepts slug scopes sent by the UI", () => {
    expect(tokenProjectSchema.parse({ projectId: randomUUID(), scope: "write" })).toEqual({
      projectId: expect.any(String),
      scope: "write",
    });
    expect(tokenProjectSchema.parse({ projectId: randomUUID(), scope: "read" }).scope).toBe("read");
  });

  it("rejects unknown scopes and malformed ids", () => {
    expect(() => tokenProjectSchema.parse({ projectId: randomUUID(), scope: "admin" })).toThrow();
    expect(() => tokenProjectSchema.parse({ projectId: "nope", scope: "read" })).toThrow();
  });

  it("bounds the project list a single token may carry", () => {
    // Every item is resolved against the database, so the array length is a
    // bound on the work one request can ask for.
    const projectId = randomUUID();
    const entry = { projectId, scope: "read" as const };
    const atCap = Array.from({ length: MAX_TOKEN_PROJECTS }, () => entry);
    expect(tokenCreateInput.parse({ name: "t", projects: atCap, expiresInDays: 7 }).projects).toHaveLength(MAX_TOKEN_PROJECTS);

    const overCap = Array.from({ length: MAX_TOKEN_PROJECTS + 1 }, () => entry);
    expect(() => tokenCreateInput.parse({ name: "t", projects: overCap, expiresInDays: 7 })).toThrow();
  });
});

describe("token create route", () => {
  it("refuses a caller with no access before it resolves the projects", async () => {
    const { projectId } = await makeProject(`tok-authz-${suffix}`);
    const [collab] = await db
      .insert(users)
      .values({ email: `tok-collab-${suffix}@sigit.test`, passwordHash: "x", role: "collaborator" })
      .returning();
    createdUserIds.push(collab.id);
    const { token } = await createSession(collab.id);

    const headers = new Headers({ Cookie: `${SESSION_COOKIE}=${token}`, "Content-Type": "application/json" });
    const body = (id: string) => JSON.stringify({ name: "t", projects: [{ projectId: id, scope: "read" }], expiresInDays: 7 });

    // A project that exists but is not theirs, and one that does not exist at
    // all: both answer 403, so the response does not tell them apart.
    const foreign = await tokenRoutes.request("/", { method: "POST", headers, body: body(projectId) });
    expect(foreign.status).toBe(403);
    const ghost = await tokenRoutes.request("/", { method: "POST", headers, body: body(randomUUID()) });
    expect(ghost.status).toBe(403);
  });

  it("still reports a missing project to an admin", async () => {
    const admin = await adminUser();
    if (!admin) throw new Error("no admin user in DB");
    const { token } = await createSession(admin.id);
    const res = await tokenRoutes.request("/", {
      method: "POST",
      headers: new Headers({ Cookie: `${SESSION_COOKIE}=${token}`, "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "t", projects: [{ projectId: randomUUID(), scope: "read" }], expiresInDays: 7 }),
    });
    expect(res.status).toBe(400);
  });
});

describe("token project scopes", () => {
  it("resolves the granted scope for a project", async () => {
    const { projectId } = await makeProject(`tok-scope-${suffix}`);
    const { tokenId } = await makeToken(`test-tok-${suffix}`);
    await setTokenProjectScopes(tokenId, [{ projectId, scope: "write" }]);

    const scope = await resolveTokenScope(tokenId, projectId);
    expect(scope).toBe("write");
  });

  it("returns undefined for a project without a scope row", async () => {
    const { projectId } = await makeProject(`tok-noscope-${suffix}`);
    const { tokenId } = await makeToken(`test-noscope-${suffix}`);

    const scope = await resolveTokenScope(tokenId, projectId);
    expect(scope).toBeUndefined();
  });

  it("ignores tokens with no scope rows for other projects", async () => {
    const { projectId: a } = await makeProject(`tok-multi-a-${suffix}`);
    const { projectId: b } = await makeProject(`tok-multi-b-${suffix}`);
    const { tokenId } = await makeToken(`test-multi-${suffix}`);
    await setTokenProjectScopes(tokenId, [{ projectId: a, scope: "read" }]);

    expect(await resolveTokenScope(tokenId, a)).toBe("read");
    expect(await resolveTokenScope(tokenId, b)).toBeUndefined();
  });

  it("validates a raw token after creation", async () => {
    const { tokenId, raw } = await makeToken(`test-validate-${suffix}`);
    const validated = await validateToken(raw);
    expect(validated?.id).toBe(tokenId);
  });

  it("lists tokens with their per-project scopes in one query", async () => {
    const admin = await adminUser();
    if (!admin) throw new Error("no admin user in DB");
    const { projectId } = await makeProject(`tok-list-${suffix}`);
    const { tokenId } = await makeToken(`test-list-${suffix}`);
    await setTokenProjectScopes(tokenId, [{ projectId, scope: "read" }]);

    const withScopes = await listTokensWithProjectScopes(admin.id);
    const entry = withScopes.find((item) => item.token.id === tokenId);
    expect(entry?.projects).toEqual([{ projectId, scope: "read" }]);

    const plain = await listTokens(admin.id);
    expect(plain.some((t) => t.id === tokenId)).toBe(true);
  });
});
