const API_BASE = "/api";

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type Connection = {
  id: string;
  name: string;
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  useEncryption: boolean;
};

export type NewConnection = Omit<Connection, "id"> & {
  accessKeyId: string;
  secretAccessKey: string;
  encryptionSalt?: string;
};

export async function listConnections() {
  return api<{ data: Connection[] }>("/storage/connections");
}

export async function createConnection(data: NewConnection) {
  return api<{ data: Connection }>("/storage/connections", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteConnection(id: string) {
  return api<{ data: { id: string } }>(`/storage/connections/${id}`, {
    method: "DELETE",
  });
}

export async function testConnection(id: string) {
  return api<{ ok: boolean; error?: string }>(`/storage/connections/${id}/test`, {
    method: "POST",
  });
}

export async function listObjects(id: string, prefix?: string) {
  const qs = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
  return api<{ data: { key?: string; size?: number; lastModified?: string }[] }>(
    `/storage/connections/${id}/objects${qs}`
  );
}

export async function deleteObject(id: string, key: string) {
  return api<{ data: { key: string } }>(`/storage/connections/${id}/objects/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
}

export type Project = {
  id: string;
  name: string;
  description?: string;
  storageConnectionId: string | null;
  lfsSizeThreshold: number;
  lfsPatterns?: string;
  useEncryption: boolean;
};

export type NewProject = Omit<Project, "id" | "storageConnectionId"> & {
  storageConnectionId: string;
};

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

export type NewConnectionInput = {
  name: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle?: boolean;
  useEncryption?: boolean;
};

export type CreateProjectWithConnectionInput = {
  name: string;
  description?: string;
  connection: NewConnectionInput;
};

export async function createProjectWithConnection(data: CreateProjectWithConnectionInput) {
  return api<{ data: Project }>("/projects/with-connection", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export type DeleteProjectResult = {
  deletedDb: boolean;
  deletedRepo: boolean;
  deletedS3Objects: number;
  hadStorage: boolean;
};

export async function deleteProject(id: string) {
  return api<{ data: DeleteProjectResult }>(`/projects/${id}`, { method: "DELETE" });
}

export async function updateProject(id: string, data: Partial<NewProject>) {
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

export async function pushProject(id: string, files: FileList, message: string, passphrase?: string) {
  const qs = new URLSearchParams();
  qs.set("message", message);
  if (passphrase) qs.set("passphrase", passphrase);
  const form = new FormData();
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    form.append(file.webkitRelativePath || file.name, file);
  }
  return api<{ data: { commitHash: string; files: { path: string; lfs: boolean; oid?: string }[] } }>(
    `/projects/${id}/push?${qs.toString()}`,
    {
      method: "POST",
      body: form,
    }
  );
}

export async function getProjectHistory(id: string) {
  return api<{ data: { head: string | null; commits: { hash: string; date: string; message: string; author: string }[] } }>(
    `/projects/${id}/history`
  );
}

export async function getProjectDiff(id: string, hash: string) {
  return api<{ data: { diff: string; files: { path: string; status: string }[] } }>(`/projects/${id}/history/${hash}/diff`);
}

export type CurrentUser = { id: string; email: string };

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

export type LogEntry = {
  ts: string;
  scope: string;
  message: string;
  level?: string;
  event?: string;
};

export async function getLogs(limit?: number, before?: string) {
  const qs = new URLSearchParams();
  if (limit) qs.set("limit", String(limit));
  if (before) qs.set("before", before);
  return api<{ data: LogEntry[] }>(`/admin/logs?${qs.toString()}`);
}

export function openLogStream(onEntry: (entry: LogEntry) => void): { close: () => void } {
  const es = new EventSource("/api/admin/logs/stream");
  es.onmessage = (ev) => {
    try {
      onEntry(JSON.parse(ev.data) as LogEntry);
    } catch {
      // ignore malformed
    }
  };
  return { close: () => es.close() };
}
