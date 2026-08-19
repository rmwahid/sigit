// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { api } from "$lib/api/client";

// api(): fetch wrapper - credentials include, JSON headers, error extraction
// from the { error: { code, message } } envelope or a bare { message }.

function mockFetch(response: { ok: boolean; json: () => Promise<unknown> }) {
  return vi.fn().mockResolvedValue(response as unknown as Response);
}

describe("api client", () => {
  it("sends credentials and JSON headers", async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => ({ data: { id: "1" } }) });
    vi.stubGlobal("fetch", fetchMock);
    await api<{ data: { id: string } }>("/projects/1");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/projects/1"), expect.objectContaining({ credentials: "include" }));
    expect(fetchMock.mock.calls[0]![1]!.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("throws the API error message from the error envelope", async () => {
    vi.stubGlobal("fetch", mockFetch({ ok: false, json: async () => ({ error: { code: "FORBIDDEN", message: "No access" } }) }));
    await expect(api("/x")).rejects.toThrow("No access");
  });

  it("falls back to the bare message, then to the status text", async () => {
    vi.stubGlobal("fetch", mockFetch({ ok: false, json: async () => ({ message: "gone" }) }));
    await expect(api("/x")).rejects.toThrow("gone");
  });

  it("falls back to the status text when the body is not json", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error("not json"); } } as unknown as Response));
    await expect(api("/x")).rejects.toThrow("Request failed: 500");
  });
});
