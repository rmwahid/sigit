import { api } from "./client";
import { API_PATHS } from "$lib/constants/paths";

// Branch protection API client (routes/branch-protection.ts). Listing needs
// view permission; create/update/delete need push.

export type ProtectionRule = {
  id: string;
  projectId: string;
  branchPattern: string;
  requirePr: boolean;
  requiredApprovals: number;
  blockOnRequestChanges: boolean;
  blockForcePush: boolean;
  blockDeletion: boolean;
  restrictPushUserIds: string[];
  restrictMergeUserIds: string[];
  allowAdminBypass: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProtectionRuleInput = {
  branchPattern: string;
  requirePr: boolean;
  requiredApprovals: number;
  blockOnRequestChanges: boolean;
  blockForcePush: boolean;
  blockDeletion: boolean;
  restrictPushUserIds: string[];
  restrictMergeUserIds: string[];
  allowAdminBypass: boolean;
};

export function listProjectProtectionRules(id: string) {
  return api<{ data: ProtectionRule[] }>(`${API_PATHS.PROJECTS}/${id}/branch-protection`);
}

export function createProjectProtectionRule(id: string, input: ProtectionRuleInput) {
  return api<{ data: ProtectionRule }>(`${API_PATHS.PROJECTS}/${id}/branch-protection`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateProjectProtectionRule(id: string, ruleId: string, input: Partial<ProtectionRuleInput>) {
  return api<{ data: ProtectionRule }>(`${API_PATHS.PROJECTS}/${id}/branch-protection/${ruleId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteProjectProtectionRule(id: string, ruleId: string) {
  return api<{ message: string }>(`${API_PATHS.PROJECTS}/${id}/branch-protection/${ruleId}`, {
    method: "DELETE",
  });
}
