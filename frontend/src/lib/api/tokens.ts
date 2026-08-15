import { api } from "./client";
import type { TokenScope } from "$lib/constants/scopes";
import { API_PATHS } from "$lib/constants/paths";

export type TokenProjectScope = {
  projectId: string;
  scope: TokenScope;
};

export type GitToken = {
  id: string;
  name: string;
  projects: TokenProjectScope[];
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
};

export type CreatedToken = {
  id: string;
  token: string;
  name: string;
  projects: TokenProjectScope[];
  expiresAt: string;
};

export async function listTokens() {
  return api<{ data: GitToken[] }>(API_PATHS.TOKENS);
}

export async function createToken(name: string, projects: TokenProjectScope[], expiresInDays: number) {
  return api<{ data: CreatedToken }>(API_PATHS.TOKENS, {
    method: "POST",
    body: JSON.stringify({ name, projects, expiresInDays }),
  });
}

export async function revokeToken(id: string) {
  return api<{ message: string }>(`${API_PATHS.TOKENS}/${id}`, { method: "DELETE" });
}
