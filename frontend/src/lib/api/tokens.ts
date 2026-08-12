import { api } from "./client";

export type TokenScope = "read" | "write";

export type GitToken = {
  id: string;
  name: string;
  scopes: TokenScope[];
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
};

export type CreatedToken = {
  id: string;
  token: string;
  name: string;
  scopes: TokenScope[];
  expiresAt: string;
};

export async function listTokens() {
  return api<{ data: GitToken[] }>("/tokens");
}

export async function createToken(name: string, scopes: TokenScope[], expiresInDays: number) {
  return api<{ data: CreatedToken }>("/tokens", {
    method: "POST",
    body: JSON.stringify({ name, scopes, expiresInDays }),
  });
}

export async function revokeToken(id: string) {
  return api<{ message: string }>(`/tokens/${id}`, { method: "DELETE" });
}
