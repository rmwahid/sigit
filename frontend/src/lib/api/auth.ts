import { api } from "./client";
import type { CurrentUser } from "./types";
import type { UserRole } from "../constants/roles";
import { API_PATHS } from "../constants/paths";

export async function getBootstrap() {
  return api<{ data: { needsSetup: boolean } }>(API_PATHS.AUTH_BOOTSTRAP);
}

export async function getMe() {
  return api<{ data: CurrentUser }>(API_PATHS.AUTH_ME);
}

export async function login(email: string, password: string) {
  return api<{ data: CurrentUser }>(API_PATHS.AUTH_LOGIN, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function logout() {
  return api<{ message: string }>(API_PATHS.AUTH_LOGOUT, { method: "POST" });
}

export async function revokeAllSessions(password: string) {
  return api<{ message: string }>(API_PATHS.AUTH_REVOKE_ALL, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export async function changePassword(currentPassword: string, newPassword: string) {
  return api<{ message: string }>(API_PATHS.AUTH_CHANGE_PASSWORD, {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function getInvite(token: string) {
  return api<{ data: { email: string; role: UserRole } }>(
    `${API_PATHS.AUTH_INVITE}?token=${encodeURIComponent(token)}`
  );
}

export async function acceptInvite(token: string, password: string) {
  return api<{ data: CurrentUser }>(API_PATHS.AUTH_INVITE_ACCEPT, {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}
