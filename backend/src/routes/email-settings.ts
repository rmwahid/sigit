import { AUDIT_EVENTS } from "../constants/audit-events";
import { ERROR_CODES } from "../constants/errors";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getEmailSettings, saveEmailSettings, sendEmail } from "../modules/email/resend";
import { maskSecret } from "../lib/secret-encryption";
import { requireAdmin, type AuthEnv } from "../middleware/auth";
import { audit } from "../lib/logger";
import { decryptSecret } from "../lib/secret-encryption";

const emailSettingsResponse = z.object({
  data: z.object({
    apiKeyMasked: z.string().nullable(),
    hasApiKey: z.boolean(),
    fromEmail: z.string().nullable(),
  }),
});
const emailSettingsInput = z.object({
  apiKey: z.string().min(1).optional(),
  fromEmail: z.string().email().optional(),
});
const messageResponse = z.object({ message: z.string() });
const errorSchema = z.object({ error: z.string() }).openapi("Error");

export const emailSettingsRoutes = new OpenAPIHono<AuthEnv>();

emailSettingsRoutes.openapi(
  createRoute({
    method: "get",
    path: "/",
    tags: ["Email"],
    summary: "Get email settings (admin only)",
    responses: {
      200: {
        description: "Email settings (key masked)",
        content: { "application/json": { schema: emailSettingsResponse } },
      },
    },
  }),
  async (c) => {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "Admin only" } }, 403) as never;
    const settings = await getEmailSettings();
    let apiKeyMasked: string | null = null;
    if (settings?.resendApiKeyEncrypted) {
      const raw = decryptSecret({
        keyId: settings.encryptionKeyId,
        ciphertext: settings.resendApiKeyEncrypted,
      });
      apiKeyMasked = maskSecret(raw);
    }
    return c.json({
      data: {
        apiKeyMasked,
        hasApiKey: !!settings?.resendApiKeyEncrypted,
        fromEmail: settings?.fromEmail ?? null,
      },
    });
  }
);

emailSettingsRoutes.openapi(
  createRoute({
    method: "put",
    path: "/",
    tags: ["Email"],
    summary: "Update email settings (admin only)",
    request: {
      body: { content: { "application/json": { schema: emailSettingsInput } } },
    },
    responses: {
      200: {
        description: "Updated",
        content: { "application/json": { schema: messageResponse } },
      },
    },
  }),
  async (c) => {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "Admin only" } }, 403) as never;
    const body = c.req.valid("json");
    await saveEmailSettings(body);
    audit(AUDIT_EVENTS.EMAIL_UPDATE, { hasApiKey: !!body.apiKey, fromEmail: body.fromEmail, by: admin.email });
    return c.json({ message: "Email settings updated" });
  }
);

emailSettingsRoutes.openapi(
  createRoute({
    method: "post",
    path: "/test",
    tags: ["Email"],
    summary: "Send a test email to the current admin (admin only)",
    responses: {
      200: {
        description: "Test result",
        content: { "application/json": { schema: messageResponse } },
      },
    },
  }),
  async (c) => {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "Admin only" } }, 403) as never;
    const result = await sendEmail(admin.email, "SiGit test email", "<p>SiGit email delivery works.</p>");
    audit(AUDIT_EVENTS.EMAIL_TEST, { sent: result.sent, error: result.error ?? null, by: admin.email });
    if (!result.sent) {
      return c.json({ error: { code: ERROR_CODES.BAD_REQUEST, message: result.error ?? "Email not configured" } }, 400) as never;
    }
    return c.json({ message: `Test email sent to ${admin.email}` });
  }
);
