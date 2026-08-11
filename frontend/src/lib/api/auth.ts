import { api } from "./client";
import type { CurrentUser } from "./types";

export async function getBootstrap() {
  return api<{ data: { needsSetup: boolean } }>("/auth/bootstrap");
}

export async function getMe() {
  return api<{ data: CurrentUser }>("/auth/me");
}

export async function login(email: string, password: string) {
  return api<{ data: CurrentUser }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function logout() {
  return api<{ message: string }>("/auth/logout", { method: "POST" });
}

export async function revokeAllSessions(password: string) {
  return api<{ message: string }>("/auth/revoke-all", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export async function changePassword(currentPassword: string, newPassword: string) {
  return api<{ message: string }>("/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}
