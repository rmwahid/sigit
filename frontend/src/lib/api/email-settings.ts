import { api } from "./client";
import { API_PATHS } from "$lib/constants/paths";

export type EmailSettings = {
  apiKeyMasked: string | null;
  hasApiKey: boolean;
  fromEmail: string | null;
};

export async function getEmailSettings() {
  return api<{ data: EmailSettings }>(API_PATHS.EMAIL_SETTINGS);
}

export async function updateEmailSettings(input: { apiKey?: string; fromEmail?: string }) {
  return api<{ message: string }>(API_PATHS.EMAIL_SETTINGS, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function testEmail() {
  return api<{ message: string }>(API_PATHS.EMAIL_TEST, { method: "POST" });
}
