import crypto from "node:crypto";
import { eq, and, gt, ne } from "drizzle-orm";
import { db } from "../../config/db";
import { users, sessions, type User } from "../../db/schema/auth";

const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? "7");

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, {
    algorithm: "argon2id",
    memoryCost: 19456,
    timeCost: 2,
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    expiresAt,
  });
  return { token, expiresAt };
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const rows = await db.select().from(users).where(eq(users.email, email));
  return rows[0];
}

export async function countUsers(): Promise<number> {
  const rows = await db.select({ id: users.id }).from(users);
  return rows.length;
}

export async function createAdminUser(email: string, password: string): Promise<User> {
  const passwordHash = await hashPassword(password);
  const rows = await db.insert(users).values({ email, passwordHash }).returning();
  return rows[0];
}

export async function updateUserPassword(userId: string, newPassword: string): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
}

export async function validateSessionToken(token: string): Promise<User | null> {
  const tokenHash = sha256(token);
  const now = new Date();
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)));
  const row = rows[0];
  return row?.user ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  const tokenHash = sha256(token);
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

export async function deleteAllSessions(userId: string, exceptToken?: string): Promise<void> {
  const conditions = [eq(sessions.userId, userId)];
  if (exceptToken) conditions.push(ne(sessions.tokenHash, sha256(exceptToken)));
  await db.delete(sessions).where(and(...conditions));
}

export function getSessionTokenFromCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)sigit_session=([^;]+)/);
  return match ? match[1] : null;
}

export function sessionCookie(token: string, maxAgeSeconds: number, secure = false): string {
  const maxAge = Math.floor(maxAgeSeconds);
  const parts = [
    `sigit_session=${token}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push(`Secure`);
  return parts.join("; ");
}
