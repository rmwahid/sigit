import { api } from "./client";
import type { Connection, NewConnection } from "./types";

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
