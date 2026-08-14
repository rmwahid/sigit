import { api } from "./client";
import type { UserRole } from "../constants/roles";
import { API_PATHS } from "../constants/paths";

export type Invitation = {
  id: string;
  email: string;
  role: UserRole;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
};

export type CreatedInvitation = {
  id: string;
  email: string;
  role: UserRole;
  inviteLink: string;
  emailSent: boolean;
};

export async function listInvitations() {
  return api<{ data: Invitation[] }>(API_PATHS.INVITATIONS);
}

export async function createInvitation(email: string) {
  return api<{ data: CreatedInvitation }>(API_PATHS.INVITATIONS, {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function revokeInvitation(id: string) {
  return api<{ message: string }>(`${API_PATHS.INVITATIONS}/${id}`, { method: "DELETE" });
}
