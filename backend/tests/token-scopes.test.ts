import { describe, expect, it, afterAll } from "bun:test";
import { db } from "../src/config/db";
import { users } from "../src/db/schema/auth";
import {
  createToken,
  listTokenProjectScopes,
  resolveTokenScope,
  revokeToken,
  setTokenProjectScopes,
  validateToken,
} from "../src/modules/auth/tokens";
import { createConnectionFromInput, deleteConnection } from "../src/modules/storage/connections";
import { createProject, hardDeleteProject } from "../src/modules/projects/projects";

// Per-project token scopes: dev DB `sigit` (no MinIO, no S3 operations here).
const TEST_TIMEOUT = 30000;

const suffix = Date.now().toString(36);
const createdProjectIds: string[] = [];
const createdConnectionIds: string[] = [];
const createdTokenIds: string[] = [];

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
}

afterAll(async () => {
  await cleanup();
}, TEST_TIMEOUT);

describe("token project scopes", () => {
  it("resolves the granted scope for a project", async () => {
    const { projectId } = await makeProject(`tok-scope-${suffix}`);
    const { tokenId } = await makeToken(`test-tok-${suffix}`);
    await setTokenProjectScopes(tokenId, [{ projectId, scope: "write" }]);

    const scope = await resolveTokenScope(tokenId, projectId);
    expect(scope).toBe("write");
    const projects = await listTokenProjectScopes(tokenId);
    expect(projects).toEqual([{ projectId, scope: "write" }]);
  });

  it("returns undefined for a project without a scope row", async () => {
    const { projectId } = await makeProject(`tok-noscope-${suffix}`);
    const { tokenId } = await makeToken(`test-noscope-${suffix}`);

    const scope = await resolveTokenScope(tokenId, projectId);
    expect(scope).toBeUndefined();
    expect(await listTokenProjectScopes(tokenId)).toEqual([]);
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
});
