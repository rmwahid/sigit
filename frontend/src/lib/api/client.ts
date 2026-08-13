import { API_BASE } from "../constants/paths";

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
    const message =
      typeof body?.error === "string"
        ? body.error
        : typeof body?.error?.message === "string"
          ? body.error.message
          : body?.message || `Request failed: ${res.status}`;
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}
