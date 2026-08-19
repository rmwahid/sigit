// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  createProjectPullRequest,
  deleteProjectPullRequest,
  getProjectPullRequest,
  getProjectPullRequestDiff,
  listProjectPullRequests,
  updateProjectPullRequest,
} from "$lib/api/pull-requests";

// Pull request API client: request paths, methods, and payloads (the fetch
// wrapper itself is covered by tests/client.test.ts).

function mockFetch(response: { ok: boolean; json: () => Promise<unknown> }) {
  return vi.fn().mockResolvedValue(response as unknown as Response);
}

const pr = {
  id: "pr-1",
  number: 1,
  title: "Add feature",
  description: null,
  baseBranch: "main",
  headBranch: "feature/x",
  baseSha: "a".repeat(40),
  headSha: "b".repeat(40),
  author: { id: "u1", email: "a@sigit.test" },
  status: "open",
  mergeMethod: null,
  mergeCommitSha: null,
  mergedById: null,
  mergedAt: null,
  closedAt: null,
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z",
};

describe("pull request api client", () => {
  it("lists pull requests (optional status filter)", async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => ({ data: [pr] }) });
    vi.stubGlobal("fetch", fetchMock);
    await listProjectPullRequests("proj-1");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/projects/proj-1/pull-requests");
    await listProjectPullRequests("proj-1", "open");
    expect(String(fetchMock.mock.calls[1]![0])).toContain("?status=open");
  });

  it("creates with a JSON body", async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => ({ data: pr }) });
    vi.stubGlobal("fetch", fetchMock);
    const res = await createProjectPullRequest("proj-1", { title: "Add feature", baseBranch: "main", headBranch: "feature/x" });
    expect(res.data.number).toBe(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/projects/proj-1/pull-requests");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ title: "Add feature", baseBranch: "main", headBranch: "feature/x" });
  });

  it("gets detail and diff", async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => ({ data: pr }) });
    vi.stubGlobal("fetch", fetchMock);
    await getProjectPullRequest("proj-1", 3);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/projects/proj-1/pull-requests/3");
    const diffMock = mockFetch({ ok: true, json: async () => ({ diff: "--- a/x" }) });
    vi.stubGlobal("fetch", diffMock);
    const diffRes = await getProjectPullRequestDiff("proj-1", 3);
    expect(diffRes.diff).toContain("--- a/x");
    expect(String(diffMock.mock.calls[0]![0])).toContain("/projects/proj-1/pull-requests/3/diff");
  });

  it("updates with PATCH and deletes with DELETE", async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => ({ data: pr }) });
    vi.stubGlobal("fetch", fetchMock);
    await updateProjectPullRequest("proj-1", 3, { status: "closed" });
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ status: "closed" });
    await deleteProjectPullRequest("proj-1", 3);
    expect((fetchMock.mock.calls[1]![1] as RequestInit).method).toBe("DELETE");
  });
});
