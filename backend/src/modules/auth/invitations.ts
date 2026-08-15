import { eq } from "drizzle-orm";
import { db } from "@/config/db";
import { env } from "@/config/env";
import { invitations } from "@/db/schema/auth";
import { INVITE_PREFIX } from "@/constants/protocol";
import { DEFAULT_ROLE, type UserRole } from "@/constants/roles";
import { ERROR_CODES } from "@/constants/errors";
import { INVITATION_TTL_HOURS, RANDOM_TOKEN_BYTES } from "@/constants/limits";
import { sha256 } from "@/lib/hash";
import { createUser, getUserByEmail } from "./auth";
// Onboarding invitations: admin invites an email, the user sets their own
// password via the invite link. Token is hashed (SHA-256) like sessions/tokens.
import crypto from "node:crypto";

export type InvitationInfo = { id: string; email: string; role: UserRole };

// Invitees are ALWAYS collaborators: the site admin is a single fixed role,
// so there is no way to mint a second admin through invitations.
export async function createInvitation(email: string): Promise<{ token: string; inviteLink: string; expiresAt: Date }> {
  const raw = INVITE_PREFIX + crypto.randomBytes(RANDOM_TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 60 * 60 * 1000);
  await db.insert(invitations).values({ email, role: DEFAULT_ROLE, tokenHash: sha256(raw), expiresAt });
  return { token: raw, inviteLink: `${env.FRONTEND_URL}/invite?token=${raw}`, expiresAt };
}

export async function validateInvitation(token: string): Promise<InvitationInfo | null> {
  if (!token.startsWith(INVITE_PREFIX)) return null;
  const inv = await db.query.invitations.findFirst({ where: eq(invitations.tokenHash, sha256(token)) });
  if (!inv) return null;
  if (inv.expiresAt.getTime() <= Date.now()) return null;
  if (inv.usedAt) return null;
  return { id: inv.id, email: inv.email, role: inv.role as UserRole };
}

export async function acceptInvitation(
  token: string,
  password: string
): Promise<{ id: string; email: string; role: UserRole }> {
  const inv = await validateInvitation(token);
  if (!inv) throw new Error(ERROR_CODES.INVALID_INVITATION);
  if (await getUserByEmail(inv.email)) throw new Error(ERROR_CODES.EMAIL_TAKEN);
  // Force the collaborator role here too: legacy invitation rows from before
  // the single-admin rule could still carry role = admin in the DB.
  const user = await createUser(inv.email, password, DEFAULT_ROLE);
  await db.update(invitations).set({ usedAt: new Date() }).where(eq(invitations.id, inv.id));
  return { id: user.id, email: user.email, role: user.role as UserRole };
}

export async function listInvitations() {
  return db.select().from(invitations).orderBy(invitations.createdAt);
}

export async function revokeInvitation(id: string): Promise<boolean> {
  const rows = await db.delete(invitations).where(eq(invitations.id, id)).returning();
  return rows.length > 0;
}
