import { api } from "./client";
import type {
  CreateProjectWithConnectionInput,
  DeleteProjectResult,
  NewProject,
  Project,
  ProjectUpdate,
} from "./types";

export async function listProjects() {
  return api<{ data: Project[] }>("/projects");
}

export async function getProject(id: string) {
  return api<{ data: Project }>(`/projects/${id}`);
}

export async function createProject(data: NewProject) {
  return api<{ data: Project }>("/projects", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function createProjectWithConnection(data: CreateProjectWithConnectionInput) {
  return api<{ data: Project }>("/projects/with-connection", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteProject(id: string) {
  return api<{ data: DeleteProjectResult }>(`/projects/${id}`, { method: "DELETE" });
}

export async function updateProject(id: string, data: ProjectUpdate) {
  return api<{ data: Project }>(`/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function backupProject(id: string) {
  return api<{ data: { key: string; size: number } }>(`/projects/${id}/backup`, { method: "POST" });
}

export async function restoreProject(id: string) {
  return api<{ message: string }>(`/projects/${id}/restore`, { method: "POST" });
}

export async function getProjectHistory(id: string) {
  return api<{ data: { head: string | null; commits: { hash: string; date: string; message: string; author: string }[] } }>(
    `/projects/${id}/history`
  );
}

export async function getProjectDiff(id: string, hash: string) {
  return api<{ data: { diff: string; files: { path: string; status: string }[] } }>(`/projects/${id}/history/${hash}/diff`);
}
