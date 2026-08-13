import { describe, expect, it, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/config/db";
import { emailSettings } from "../src/db/schema/auth";
import { getEmailSettings, saveEmailSettings, sendEmail } from "../src/modules/email/resend";
import { maskSecret } from "../src/lib/secret-encryption";

// Email delivery: dev DB `sigit` (fetch is mocked - no external calls).
const TEST_TIMEOUT = 30000;

async function cleanup() {
  await db.delete(emailSettings).where(eq(emailSettings.id, "singleton"));
}

afterAll(async () => {
  await cleanup();
}, TEST_TIMEOUT);

describe("resend email", () => {
  it("returns not configured when no api key is saved", async () => {
    await cleanup();
    const result = await sendEmail("a@test.local", "s", "<p>x</p>");
    expect(result.sent).toBe(false);
    expect(result.error).toBe("Email not configured");
  });

  it("sends via the Resend API with the saved key", async () => {
    await saveEmailSettings({ apiKey: "re_testkey123", fromEmail: "SiGit <no-reply@example.com>" });

    let captured: { url: string; init: RequestInit } | null = null;
    const fakeFetch = async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ id: "1" }), { status: 200 });
    };

    const result = await sendEmail("to@test.local", "Hello", "<p>body</p>", fakeFetch as typeof fetch);
    expect(result.sent).toBe(true);
    expect(captured?.url).toBe("https://api.resend.com/emails");
    const headers = captured?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_testkey123");
    const body = JSON.parse(String(captured?.init.body));
    expect(body.to).toBe("to@test.local");
    expect(body.from).toBe("SiGit <no-reply@example.com>");
  });

  it("reports failure on non-ok response", async () => {
    await saveEmailSettings({ apiKey: "re_testkey456" });
    const fakeFetch = async () => new Response("error", { status: 401 });
    const result = await sendEmail("to@test.local", "Hello", "<p>body</p>", fakeFetch as typeof fetch);
    expect(result.sent).toBe(false);
    expect(result.error).toContain("401");
  });

  it("masks api keys for display", () => {
    expect(maskSecret("re_abcdefgh12345678")).toBe("re_a***5678");
    expect(maskSecret("short")).toBe("***");
  });

  it("persists settings and returns them", async () => {
    await saveEmailSettings({ apiKey: "re_persist123", fromEmail: "x@example.com" });
    const settings = await getEmailSettings();
    expect(settings?.resendApiKeyEncrypted).toBeTruthy();
    expect(settings?.resendApiKeyEncrypted).not.toContain("re_persist123"); // encrypted, never plaintext
    expect(settings?.fromEmail).toBe("x@example.com");
  });
});
