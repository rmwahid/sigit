import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../config/db";
import { tokenProjectScopes, tokens, type Token } from "../../db/schema/auth";
import { TOKEN_SCOPES, type TokenScope } from "../../constants/scopes";
import { TOKEN_PREFIX } from "../../constants/protocol";
import { RANDOM_TOKEN_BYTES } from "../../constants/limits";
import { sha256 } from "../../lib/hash";
import crypto from "node:crypto";

// Maximum token lifetime in days. Single source of truth - used by the route
// (zod max) and mirrored in the frontend validation constants.
export const TOKEN_MAX_EXPIRY_DAYS = 30;

export { TOKEN_SCOPES, type TokenScope };

export type TokenProjectScopeInput = {
  projectId: string;
  scope: TokenScope;
};

// Creates a new token. The raw token is returned ONLY ONCE here;
// only its SHA-256 hash is stored in the DB. expiresAt is required.
export async function createToken(
  userId: string,
  name: string,
  expiresAt: Date
): Promise<{ token: string; id: string }> {
  const raw = TOKEN_PREFIX + crypto.randomBytes(RANDOM_TOKEN_BYTES).toString("base64url");
  const rows = await db
    .insert(tokens)
    .values({ userId, name, expiresAt, tokenHash: sha256(raw) })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("Failed to create token");
  return { token: raw, id: row.id };
}

// Sets per-project token access. Without a row here the token cannot be used
// for that project. Scope "write" automatically includes "read".
export async function setTokenProjectScopes(
  tokenId: string,
  projects: TokenProjectScopeInput[]
): Promise<void> {
  if (projects.length === 0) return;
  await db
    .insert(tokenProjectScopes)
    .values(projects.map((p) => ({ tokenId, projectId: p.projectId, scope: p.scope })));
}

// Token scope for one project: "write" | "read" | undefined (no access).
export async function resolveTokenScope(
  tokenId: string,
  projectId: string
): Promise<TokenScope | undefined> {
  const rows = await db
    .select({ scope: tokenProjectScopes.scope })
    .from(tokenProjectScopes)
    .where(and(eq(tokenProjectScopes.tokenId, tokenId), eq(tokenProjectScopes.projectId, projectId)))
    .limit(1);
  return rows[0]?.scope;
}

export async function listTokens(userId: string): Promise<Token[]> {
  return db.select().from(tokens).where(eq(tokens.userId, userId)).orderBy(tokens.createdAt);
}

export async function listTokenProjectScopes(tokenId: string): Promise<{ projectId: string; scope: TokenScope }[]> {
  const rows = await db
    .select({ projectId: tokenProjectScopes.projectId, scope: tokenProjectScopes.scope })
    .from(tokenProjectScopes)
    .where(eq(tokenProjectScopes.tokenId, tokenId));
  return rows;
}

// Lists tokens + per-project scopes in ONE query (avoids N+1).
export async function listTokensWithProjectScopes(
  userId: string
): Promise<Array<{ token: Token; projects: { projectId: string; scope: TokenScope }[] }>> {
  const items = await listTokens(userId);
  if (items.length === 0) return [];
  const rows = await db
    .select({
      tokenId: tokenProjectScopes.tokenId,
      projectId: tokenProjectScopes.projectId,
      scope: tokenProjectScopes.scope,
    })
    .from(tokenProjectScopes)
    .where(inArray(tokenProjectScopes.tokenId, items.map((t) => t.id)));
  const byToken = new Map<string, { projectId: string; scope: TokenScope }[]>();
  for (const r of rows) {
    const list = byToken.get(r.tokenId) ?? [];
    list.push({ projectId: r.projectId, scope: r.scope });
    byToken.set(r.tokenId, list);
  }
  return items.map((token) => ({ token, projects: byToken.get(token.id) ?? [] }));
}

export async function revokeToken(id: string, userId: string): Promise<boolean> {
  const rows = await db
    .delete(tokens)
    .where(and(eq(tokens.id, id), eq(tokens.userId, userId)))
    .returning();
  return rows.length > 0;
}

// Validates a raw token (Basic auth password): hash matches AND not expired.
// Updates lastUsedAt. Expired tokens are treated as invalid.
export async function validateToken(raw: string): Promise<Token | null> {
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const rows = await db.select().from(tokens).where(eq(tokens.tokenHash, sha256(raw)));
  const token = rows[0];
  if (!token) return null;
  if (token.expiresAt.getTime() <= Date.now()) return null;
  await db.update(tokens).set({ lastUsedAt: new Date() }).where(eq(tokens.id, token.id));
  return token;
}
