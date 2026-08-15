import { DEFAULT_ROLE, ROLE_SLUGS } from "@/constants/roles";
import { AUDIT_EVENTS } from "@/constants/audit-events";
import { ERROR_CODES } from "@/constants/errors";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { createInvitation, listInvitations, revokeInvitation } from "@/modules/auth/invitations";
import { sendEmail } from "@/modules/email/resend";
import { requireAdmin, type AuthEnv } from "@/middleware/auth";
import { audit } from "@/lib/logger";
import { idParamSchema } from "./schemas/common";

const invitationSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
    role: z.enum(ROLE_SLUGS),
    expiresAt: z.string().datetime(),
    usedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi("Invitation");

const invitationListResponse = z.object({ data: z.array(invitationSchema) });
// Role is NOT part of the create input: invitees are always collaborators
// (single admin model), so the role cannot be minted via the API.
const invitationCreateInput = z.object({
  email: z.string().email(),
});
const invitationCreatedResponse = z.object({
  data: z.object({
    id: z.string().uuid(),
    email: z.string(),
    role: z.enum(ROLE_SLUGS),
    // Fallback: shown when email delivery is not configured.
    inviteLink: z.string(),
    emailSent: z.boolean(),
  }),
});
const messageResponse = z.object({ message: z.string() });
const errorSchema = z.object({ error: z.string() }).openapi("Error");

export const invitationRoutes = new OpenAPIHono<AuthEnv>();

invitationRoutes.openapi(
  createRoute({
    method: "get",
    path: "/",
    tags: ["Invitations"],
    summary: "List invitations (admin only)",
    responses: {
      200: {
        description: "List of invitations",
        content: { "application/json": { schema: invitationListResponse } },
      },
    },
  }),
  async (c) => {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "Admin only" } }, 403) as never;
    const items = await listInvitations();
    return c.json({
      data: items.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        expiresAt: i.expiresAt.toISOString(),
        usedAt: i.usedAt ? i.usedAt.toISOString() : null,
        createdAt: i.createdAt.toISOString(),
      })),
    });
  }
);

invitationRoutes.openapi(
  createRoute({
    method: "post",
    path: "/",
    tags: ["Invitations"],
    summary: "Invite a user by email (admin only)",
    request: {
      body: { content: { "application/json": { schema: invitationCreateInput } } },
    },
    responses: {
      201: {
        description: "Invitation created, email sent if configured",
        content: { "application/json": { schema: invitationCreatedResponse } },
      },
    },
  }),
  async (c) => {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "Admin only" } }, 403) as never;
    const { email } = c.req.valid("json");
    const { inviteLink } = await createInvitation(email);
    const mail = await sendEmail(
      email,
      "You have been invited to SiGit",
      `<p>Set up your SiGit account here:</p><p><a href="${inviteLink}">${inviteLink}</a></p>`
    );
    audit(AUDIT_EVENTS.INVITATION_CREATE, { email, role: DEFAULT_ROLE, emailSent: mail.sent, by: admin.email });
    const invitation = (await listInvitations()).find((i) => i.email === email);
    return c.json(
      {
        data: {
          id: invitation?.id ?? "",
          email,
          role: DEFAULT_ROLE,
          inviteLink,
          emailSent: mail.sent,
        },
      },
      201
    );
  }
);

invitationRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/{id}",
    tags: ["Invitations"],
    summary: "Revoke an invitation (admin only)",
    request: { params: idParamSchema },
    responses: {
      200: {
        description: "Revoked",
        content: { "application/json": { schema: messageResponse } },
      },
      404: {
        description: "Not found",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "Admin only" } }, 403) as never;
    const { id } = c.req.valid("param");
    const revoked = await revokeInvitation(id);
    if (!revoked) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Not found" } }, 404) as never;
    audit(AUDIT_EVENTS.INVITATION_REVOKE, { invitationId: id, by: admin.email });
    return c.json({ message: "Revoked" });
  }
);
