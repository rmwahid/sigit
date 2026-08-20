import { api } from "./client";
import { API_PATHS } from "$lib/constants/paths";
import type { PrStatus, PrMergeableStatus, ReviewState } from "$lib/constants/pull-requests";

// Pull request API client (routes/pull-requests.ts). Creating/updating
// requires the push permission; listing/detail requires view; the diff
// endpoint requires the diff permission.

export type PrAuthor = { id: string; email: string };
export type PrComment = { id: string; body: string; author: PrAuthor; createdAt: string };
export type PrReview = { id: string; state: string; body: string | null; author: PrAuthor; createdAt: string };

export type PullRequest = {
  id: string;
  number: number;
  title: string;
  description: string | null;
  baseBranch: string;
  headBranch: string;
  baseSha: string;
  headSha: string;
  author: PrAuthor;
  status: PrStatus;
  mergeableStatus: PrMergeableStatus;
  mergeMethod: string | null;
  mergeCommitSha: string | null;
  mergedById: string | null;
  mergedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PullRequestDetail = PullRequest & { comments: PrComment[]; reviews: PrReview[] };

export type PrCreateInput = {
  title: string;
  description?: string;
  baseBranch: string;
  headBranch: string;
};

export function listProjectPullRequests(id: string, status?: PrStatus) {
  const qs = status ? `?status=${status}` : "";
  return api<{ data: PullRequest[] }>(`${API_PATHS.PROJECTS}/${id}/pull-requests${qs}`);
}

export function getProjectPullRequest(id: string, number: number) {
  return api<{ data: PullRequestDetail }>(`${API_PATHS.PROJECTS}/${id}/pull-requests/${number}`);
}

export function createProjectPullRequest(id: string, input: PrCreateInput) {
  return api<{ data: PullRequest }>(`${API_PATHS.PROJECTS}/${id}/pull-requests`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateProjectPullRequest(
  id: string,
  number: number,
  input: Partial<Pick<PullRequest, "title" | "description" | "status">>
) {
  return api<{ data: PullRequest }>(`${API_PATHS.PROJECTS}/${id}/pull-requests/${number}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteProjectPullRequest(id: string, number: number) {
  return api<{ message: string }>(`${API_PATHS.PROJECTS}/${id}/pull-requests/${number}`, {
    method: "DELETE",
  });
}

export function getProjectPullRequestDiff(id: string, number: number) {
  return api<{ diff: string }>(`${API_PATHS.PROJECTS}/${id}/pull-requests/${number}/diff`);
}

export function mergeProjectPullRequest(id: string, number: number, method: "merge" | "squash" | "fast_forward") {
  return api<{ data: PullRequest }>(`${API_PATHS.PROJECTS}/${id}/pull-requests/${number}/merge`, {
    method: "POST",
    body: JSON.stringify({ method }),
  });
}

export function addProjectPullRequestComment(id: string, number: number, body: string) {
  return api<{ data: PrComment }>(`${API_PATHS.PROJECTS}/${id}/pull-requests/${number}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function submitProjectPullRequestReview(
  id: string,
  number: number,
  state: ReviewState,
  body?: string
) {
  return api<{ data: PrReview }>(`${API_PATHS.PROJECTS}/${id}/pull-requests/${number}/reviews`, {
    method: "POST",
    body: JSON.stringify({ state, ...(body ? { body } : {}) }),
  });
}
