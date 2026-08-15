import { and, eq, gt, ne } from "drizzle-orm";
import { db } from "@/config/db";
import { env } from "@/config/env";
import { sessions, type User, users } from "@/db/schema/auth";
import { ADMIN_ROLE, DEFAULT_ROLE, type UserRole } from "@/constants/roles";
import { COOKIE_ATTRIBUTES, SESSION_COOKIE } from "@/constants/protocol";
import { sha256 } from "@/lib/hash";
import crypto from "node:crypto";
import {
  PASSWORD_HASH_MEMORY_COST,
  PASSWORD_HASH_TIME_COST,
  RANDOM_KEY_BYTES,
} from "@/constants/limits";

const SESSION_TTL_DAYS = Number(env.SESSION_TTL_DAYS);

// Session cookie max age in seconds (parsed once; routes reuse this).
export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60;

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, {
    algorithm: "argon2id",
    memoryCost: PASSWORD_HASH_MEMORY_COST,
    timeCost: PASSWORD_HASH_TIME_COST,
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

export function generateSessionToken(): string {
  return crypto.randomBytes(RANDOM_KEY_BYTES).toString("base64url");
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
  return db.query.users.findFirst({ where: eq(users.email, email) });
}

export async function countUsers(): Promise<number> {
  const rows = await db.select({ id: users.id }).from(users);
  return rows.length;
}

// Generic user creation (admin invitation flow + CLI). Role defaults to "user";
// the bootstrap CLI passes "admin" for the first account.
export async function createUser(
  email: string,
  password: string,
  role: UserRole = DEFAULT_ROLE
): Promise<User> {
  const passwordHash = await hashPassword(password);
  const rows = await db.insert(users).values({ email, passwordHash, role }).returning();
  return rows[0];
}

export async function createAdminUser(email: string, password: string): Promise<User> {
  return createUser(email, password, ADMIN_ROLE);
}

export async function listUsers(): Promise<Array<Pick<User, "id" | "email" | "role" | "createdAt">>> {
  return db
    .select({ id: users.id, email: users.email, role: users.role, createdAt: users.createdAt })
    .from(users)
    .orderBy(users.createdAt);
}

// Admin reset password: sets a temporary password and revokes all sessions.
export async function setUserPassword(id: string, newPassword: string): Promise<void> {
  await updateUserPassword(id, newPassword);
  await deleteAllSessions(id);
}

// FK cascade removes sessions, git tokens, and collaborator rows.
export async function deleteUser(id: string): Promise<boolean> {
  const rows = await db.delete(users).where(eq(users.id, id)).returning();
  return rows.length > 0;
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
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}

export function sessionCookie(token: string, maxAgeSeconds: number, secure = false): string {
  const maxAge = Math.floor(maxAgeSeconds);
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    COOKIE_ATTRIBUTES.PATH,
    COOKIE_ATTRIBUTES.HTTP_ONLY,
    COOKIE_ATTRIBUTES.SAME_SITE_LAX,
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push(COOKIE_ATTRIBUTES.SECURE);
  return parts.join("; ");
}
