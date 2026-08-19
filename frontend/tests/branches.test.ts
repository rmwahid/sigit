import { describe, expect, it, vi } from "vitest";
import { createProjectBranch, deleteProjectBranch, listProjectBranches } from "$lib/api/branches";

// Mocks the shared api client (branches.ts imports "./client", which resolves
// to the same module as "$lib/api/client").
const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("$lib/api/client", () => ({ api: (...args: unknown[]) => apiMock(...args) }));

describe("branch api client", () => {
  it("lists branches", async () => {
    apiMock.mockResolvedValueOnce({ data: { branches: ["main", "feature/x"] } });
    const res = await listProjectBranches("pid");
    expect(apiMock).toHaveBeenCalledWith("/projects/pid/branches");
    expect(res.data.branches).toEqual(["main", "feature/x"]);
  });

  it("creates a branch from an explicit ref", async () => {
    apiMock.mockResolvedValueOnce({ data: { name: "feature/x" } });
    await createProjectBranch("pid", "feature/x", "main");
    expect(apiMock).toHaveBeenCalledWith("/projects/pid/branches", {
      method: "POST",
      body: JSON.stringify({ name: "feature/x", fromBranch: "main" }),
    });
  });

  it("deletes a branch, encoding the name (may contain slashes)", async () => {
    apiMock.mockResolvedValueOnce({ message: "Branch deleted" });
    await deleteProjectBranch("pid", "feature/x");
    expect(apiMock).toHaveBeenCalledWith("/projects/pid/branches?branch=feature%2Fx", {
      method: "DELETE",
    });
  });
});
