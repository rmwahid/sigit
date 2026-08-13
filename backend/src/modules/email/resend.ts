import { EMAIL_FROM_DEFAULT } from "../../constants/protocol";
import { eq } from "drizzle-orm";
import { db } from "../../config/db";
import { emailSettings } from "../../db/schema/auth";
import { decryptSecret, encryptSecret, maskSecret } from "../../lib/secret-encryption";
// Email delivery via Resend (https://resend.com). The API key is stored in the
// email_settings row, wrapped with ENCRYPTION_KEYS like storage secrets.
// Without a configured key, sendEmail returns { sent: false } (callers fall
// back to showing the invite link manually).

const SINGLETON_ID = "singleton";
const RESEND_URL = "https://api.resend.com/emails";

export type SendEmailResult = { sent: boolean; error?: string };

export async function getEmailSettings() {
  const rows = await db.select().from(emailSettings).limit(1);
  return rows[0] ?? null;
}

export async function saveEmailSettings(input: { apiKey?: string; fromEmail?: string }): Promise<void> {
  const existing = await getEmailSettings();
  const values: { fromEmail?: string; resendApiKeyEncrypted?: string; encryptionKeyId?: string } = {
    fromEmail: input.fromEmail ?? existing?.fromEmail ?? undefined,
  };
  if (input.apiKey) {
    const wrapped = encryptSecret(input.apiKey);
    values.resendApiKeyEncrypted = wrapped.ciphertext;
    values.encryptionKeyId = wrapped.keyId;
  }
  if (existing) {
    await db.update(emailSettings).set({ ...values, updatedAt: new Date() }).where(eq(emailSettings.id, existing.id));
  } else {
    await db.insert(emailSettings).values({ id: SINGLETON_ID, ...values });
  }
}


export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  fetchImpl: typeof fetch = fetch
): Promise<SendEmailResult> {
  const settings = await getEmailSettings();
  if (!settings?.resendApiKeyEncrypted) {
    return { sent: false, error: "Email not configured" };
  }
  const apiKey = decryptSecret({
    keyId: settings.encryptionKeyId,
    ciphertext: settings.resendApiKeyEncrypted,
  });
  const from = settings.fromEmail ?? EMAIL_FROM_DEFAULT;
  try {
    const res = await fetchImpl(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) return { sent: false, error: `Resend error: ${res.status}` };
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : String(err) };
  }
}
