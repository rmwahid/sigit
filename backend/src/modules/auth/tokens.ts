import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../config/db";
import { tokens, type Token } from "../../db/schema/auth";

const TOKEN_PREFIX = "sigit_";

export type TokenScope = "read" | "write";

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

// Membuat token baru. Raw token hanya dikembalikan SEKALI di sini;
// yang disimpan di DB hanya hash SHA-256-nya. expiresAt WAJIB.
export async function createToken(
  userId: string,
  name: string,
  scopes: TokenScope[],
  expiresAt: Date
): Promise<{ token: string; id: string }> {
  const raw = TOKEN_PREFIX + crypto.randomBytes(24).toString("base64url");
  const rows = await db
    .insert(tokens)
    .values({ userId, name, scopes, expiresAt, tokenHash: sha256(raw) })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("Failed to create token");
  return { token: raw, id: row.id };
}

export async function listTokens(userId: string): Promise<Token[]> {
  return db.select().from(tokens).where(eq(tokens.userId, userId)).orderBy(tokens.createdAt);
}

export async function revokeToken(id: string, userId: string): Promise<boolean> {
  const rows = await db
    .delete(tokens)
    .where(and(eq(tokens.id, id), eq(tokens.userId, userId)))
    .returning();
  return rows.length > 0;
}

// Validasi raw token (password dari Basic auth): hash cocok DAN belum expired.
// Update lastUsedAt. Token expired dianggap tidak valid.
export async function validateToken(raw: string): Promise<Token | null> {
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const rows = await db.select().from(tokens).where(eq(tokens.tokenHash, sha256(raw)));
  const token = rows[0];
  if (!token) return null;
  if (token.expiresAt.getTime() <= Date.now()) return null;
  await db.update(tokens).set({ lastUsedAt: new Date() }).where(eq(tokens.id, token.id));
  return token;
}

export function tokenHasScope(token: Token, scope: TokenScope): boolean {
  return token.scopes.includes(scope);
}
