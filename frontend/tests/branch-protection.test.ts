// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  createProjectProtectionRule,
  deleteProjectProtectionRule,
  listProjectProtectionRules,
  updateProjectProtectionRule,
} from "$lib/api/branch-protection";

// Branch protection API client: request paths, methods, and payloads.

function mockFetch(response: { ok: boolean; json: () => Promise<unknown> }) {
  return vi.fn().mockResolvedValue(response as unknown as Response);
}

const rule = {
  id: "rule-1",
  projectId: "p1",
  branchPattern: "main",
  requirePr: true,
  requiredApprovals: 1,
  blockOnRequestChanges: false,
  blockForcePush: true,
  blockDeletion: true,
  restrictPushUserIds: [],
  restrictMergeUserIds: [],
  allowAdminBypass: false,
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z",
};

describe("branch protection API client", () => {
  it("lists rules with a GET to /projects/:id/branch-protection", async () => {
    const fetchMock = mockFetch({ ok: true, json: () => Promise.resolve({ data: [rule] }) });
    vi.stubGlobal("fetch", fetchMock);
    const res = await listProjectProtectionRules("p1");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/branch-protection", expect.anything());
    expect(res.data[0].branchPattern).toBe("main");
    vi.unstubAllGlobals();
  });

  it("creates a rule with a POST and the full input body", async () => {
    const fetchMock = mockFetch({ ok: true, json: () => Promise.resolve({ data: rule }) });
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      branchPattern: "release/*",
      requirePr: true,
      requiredApprovals: 2,
      blockOnRequestChanges: true,
      blockForcePush: true,
      blockDeletion: true,
      restrictPushUserIds: ["u1"],
      restrictMergeUserIds: [],
      allowAdminBypass: false,
    };
    const res = await createProjectProtectionRule("p1", input);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/branch-protection",
      expect.objectContaining({ method: "POST" })
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual(input);
    expect(res.data.id).toBe("rule-1");
    vi.unstubAllGlobals();
  });

  it("updates a rule with a PATCH and a partial body", async () => {
    const fetchMock = mockFetch({ ok: true, json: () => Promise.resolve({ data: { ...rule, requirePr: false } }) });
    vi.stubGlobal("fetch", fetchMock);
    const res = await updateProjectProtectionRule("p1", "rule-1", { requirePr: false });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/branch-protection/rule-1",
      expect.objectContaining({ method: "PATCH" })
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ requirePr: false });
    expect(res.data.requirePr).toBe(false);
    vi.unstubAllGlobals();
  });

  it("deletes a rule with a DELETE", async () => {
    const fetchMock = mockFetch({ ok: true, json: () => Promise.resolve({ message: "Branch protection rule deleted" }) });
    vi.stubGlobal("fetch", fetchMock);
    const res = await deleteProjectProtectionRule("p1", "rule-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/branch-protection/rule-1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(res.message).toContain("deleted");
    vi.unstubAllGlobals();
  });
});
