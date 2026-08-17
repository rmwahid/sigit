import { api } from "./client";
import type { ActivityDay } from "$lib/activity";
import { API_PATHS } from "$lib/constants/paths";

export type PublicProject = {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
};

export type PublicUserProfile = {
  email: string;
  role: string;
  projects: PublicProject[];
};

export async function listPublicProjects() {
  return api<{ data: PublicProject[] }>(`${API_PATHS.EXPLORE}/projects`);
}

export async function getUserProfile(email: string) {
  return api<{ data: PublicUserProfile }>(`${API_PATHS.EXPLORE}/users/${encodeURIComponent(email)}`);
}

export async function getUserActivity(email: string) {
  return api<{ data: { days: ActivityDay[] } }>(`${API_PATHS.EXPLORE}/users/${encodeURIComponent(email)}/activity`);
}
