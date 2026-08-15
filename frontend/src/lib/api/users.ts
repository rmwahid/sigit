import { api } from "./client";
import type { UserRole } from "$lib/constants/roles";
import { API_PATHS } from "$lib/constants/paths";

export type ManagedUser = {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
};

export async function listUsers() {
  return api<{ data: ManagedUser[] }>(API_PATHS.USERS);
}

export async function resetUserPassword(id: string, password: string) {
  return api<{ message: string }>(`${API_PATHS.USERS}/${id}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export async function deleteUser(id: string) {
  return api<{ message: string }>(`${API_PATHS.USERS}/${id}`, { method: "DELETE" });
}
