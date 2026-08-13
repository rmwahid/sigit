import { api } from "./client";
import type { Connection, NewConnection } from "./types";
import { API_PATHS } from "../constants/paths";

export async function listConnections() {
  return api<{ data: Connection[] }>(API_PATHS.STORAGE_CONNECTIONS);
}

export async function createConnection(data: NewConnection) {
  return api<{ data: Connection }>(API_PATHS.STORAGE_CONNECTIONS, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteConnection(id: string) {
  return api<{ data: { id: string } }>(`${API_PATHS.STORAGE_CONNECTIONS}/${id}`, {
    method: "DELETE",
  });
}

export async function testConnection(id: string) {
  return api<{ ok: boolean; error?: string }>(`${API_PATHS.STORAGE_CONNECTIONS}/${id}/test`, {
    method: "POST",
  });
}

export async function listObjects(id: string, prefix?: string) {
  const qs = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
  return api<{ data: { key?: string; size?: number; lastModified?: string }[] }>(
    `${API_PATHS.STORAGE_CONNECTIONS}/${id}/objects${qs}`
  );
}

export async function deleteObject(id: string, key: string) {
  return api<{ data: { key: string } }>(
    `${API_PATHS.STORAGE_CONNECTIONS}/${id}/objects/${encodeURIComponent(key)}`,
    { method: "DELETE" }
  );
}
