import { api } from "./client";
import type {
  CreateProjectWithConnectionInput,
  DeleteProjectResult,
  NewProject,
  Project,
  ProjectUpdate,
} from "./types";
import { API_PATHS } from "../constants/paths";

export async function listProjects() {
  return api<{ data: Project[] }>(API_PATHS.PROJECTS);
}

export async function getProject(id: string) {
  return api<{ data: Project }>(`${API_PATHS.PROJECTS}/${id}`);
}

export async function createProject(data: NewProject) {
  return api<{ data: Project }>(API_PATHS.PROJECTS, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function createProjectWithConnection(data: CreateProjectWithConnectionInput) {
  return api<{ data: Project }>(API_PATHS.PROJECTS_WITH_CONNECTION, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteProject(id: string) {
  return api<{ data: DeleteProjectResult }>(`${API_PATHS.PROJECTS}/${id}`, { method: "DELETE" });
}

export async function updateProject(id: string, data: ProjectUpdate) {
  return api<{ data: Project }>(`${API_PATHS.PROJECTS}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function backupProject(id: string) {
  return api<{ data: { key: string; size: number } }>(`${API_PATHS.PROJECTS}/${id}/backup`, {
    method: "POST",
  });
}

export async function restoreProject(id: string) {
  return api<{ message: string }>(`${API_PATHS.PROJECTS}/${id}/restore`, { method: "POST" });
}

export async function getProjectHistory(id: string) {
  return api<{ data: { head: string | null; commits: { hash: string; date: string; message: string; author: string }[] } }>(
    `${API_PATHS.PROJECTS}/${id}/history`
  );
}

export async function getProjectDiff(id: string, hash: string) {
  return api<{ data: { diff: string; files: { path: string; status: string }[] } }>(
    `${API_PATHS.PROJECTS}/${id}/history/${hash}/diff`
  );
}

export type Collaborator = {
  id: string;
  userId: string;
  email: string;
  permissions: string[];
};

export async function listCollaborators(id: string) {
  return api<{ data: Collaborator[] }>(`${API_PATHS.PROJECTS}/${id}/collaborators`);
}

export async function addCollaborator(id: string, userId: string, permissions: string[]) {
  return api<{ data: Collaborator }>(`${API_PATHS.PROJECTS}/${id}/collaborators`, {
    method: "POST",
    body: JSON.stringify({ userId, permissions }),
  });
}

export async function updateCollaborator(id: string, userId: string, permissions: string[]) {
  return api<{ data: Collaborator }>(`${API_PATHS.PROJECTS}/${id}/collaborators/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ permissions }),
  });
}

export async function removeCollaborator(id: string, userId: string) {
  return api<{ message: string }>(`${API_PATHS.PROJECTS}/${id}/collaborators/${userId}`, {
    method: "DELETE",
  });
}
