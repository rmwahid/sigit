import { describe, expect, it, afterAll } from "bun:test";
import { ADMIN_ROLE, DEFAULT_ROLE } from "../src/constants/roles";
import { eq } from "drizzle-orm";
import { db } from "../src/config/db";
import { invitations, users } from "../src/db/schema/auth";
import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  revokeInvitation,
  validateInvitation,
} from "../src/modules/auth/invitations";
import { deleteUser, getUserByEmail } from "../src/modules/auth/auth";

// Invitation flow: dev DB `sigit` (no email delivery - only token logic here).
const TEST_TIMEOUT = 30000;

const suffix = Date.now().toString(36);
const createdUserIds: string[] = [];
const createdInvitationIds: string[] = [];

async function cleanup() {
  for (const id of createdUserIds) {
    try {
      await deleteUser(id);
    } catch {
      // best effort
    }
  }
  for (const id of createdInvitationIds) {
    try {
      await revokeInvitation(id);
    } catch {
      // best effort
    }
  }
}

afterAll(async () => {
  await cleanup();
}, TEST_TIMEOUT);

describe("invitations", () => {
  it("creates a valid invitation and accepts it (user created, auto-used)", async () => {
    const email = `invite-${suffix}@test.local`;
    const { token, inviteLink } = await createInvitation(email, DEFAULT_ROLE);

    expect(inviteLink).toContain(`token=${token}`);
    const info = await validateInvitation(token);
    expect(info).not.toBeNull();
    expect(info?.email).toBe(email);
    expect(info?.role).toBe(DEFAULT_ROLE);

    const accepted = await acceptInvitation(token, "password123");
    createdUserIds.push(accepted.id);
    expect(accepted.email).toBe(email);
    expect((await getUserByEmail(email))?.role).toBe(DEFAULT_ROLE);

    // Used invitations cannot be accepted again.
    expect(await validateInvitation(token)).toBeNull();
    let secondError = "";
    try {
      await acceptInvitation(token, "password123");
    } catch (err) {
      secondError = err instanceof Error ? err.message : String(err);
    }
    expect(secondError).toBe("INVALID_INVITATION");
  });

  it("rejects an expired invitation", async () => {
    const rows = await db
      .insert(invitations)
      .values({
        email: `expired-${suffix}@test.local`,
        role: DEFAULT_ROLE,
        tokenHash: "a".repeat(64),
        expiresAt: new Date(Date.now() - 1000),
      })
      .returning();
    createdInvitationIds.push(rows[0].id);

    expect(await validateInvitation("sigit_invite_expiredtoken")).toBeNull();
  });

  it("rejects tokens with the wrong prefix", async () => {
    expect(await validateInvitation("sigit_" + "x".repeat(32))).toBeNull();
  });

  it("rejects accepting when the email is already registered", async () => {
    const existing = (await db.select().from(users).limit(1))[0];
    const { token } = await createInvitation(existing.email, DEFAULT_ROLE);
    let error = "";
    try {
      await acceptInvitation(token, "password123");
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    expect(error).toBe("EMAIL_TAKEN");
  });

  it("lists and revokes invitations", async () => {
    const { token } = await createInvitation(`revoke-${suffix}@test.local`, "admin");
    const list = await listInvitations();
    const created = list.find((i) => i.email === `revoke-${suffix}@test.local`);
    expect(created).toBeDefined();
    expect(created?.role).toBe(ADMIN_ROLE);

    expect(await revokeInvitation(created!.id)).toBe(true);
    expect(await validateInvitation(token)).toBeNull();
    expect(await revokeInvitation(created!.id)).toBe(false);
  });
});
