import { api } from "./client";
import { API_PATHS } from "$lib/constants/paths";

// Web branch management (routes/branches.ts). Creating/deleting branches
// requires the push permission; the branch name is a query param on delete
// because names may contain slashes (feature/x).

export type BranchListResponse = { data: { branches: string[] } };

export function listProjectBranches(id: string) {
  return api<BranchListResponse>(`${API_PATHS.PROJECTS}/${id}/branches`);
}

export function createProjectBranch(id: string, name: string, fromBranch?: string) {
  return api<{ data: { name: string } }>(`${API_PATHS.PROJECTS}/${id}/branches`, {
    method: "POST",
    body: JSON.stringify({ name, fromBranch }),
  });
}

export function deleteProjectBranch(id: string, branch: string) {
  return api<{ message: string }>(`${API_PATHS.PROJECTS}/${id}/branches?branch=${encodeURIComponent(branch)}`, {
    method: "DELETE",
  });
}
