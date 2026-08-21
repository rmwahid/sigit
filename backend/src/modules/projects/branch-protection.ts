// Branch protection rules: CRUD against the branch_protection_rules table and
// pattern matching for enforcement. Pure DB + string logic (no git calls), so
// it is unit-testable; the git pre-receive hook consumes a JSON snapshot of
// the rules via writeProtectionSnapshot.
import { and, eq } from "drizzle-orm";
import { db } from "@/config/db";
import { branchProtectionRules, type BranchProtectionRule, type NewBranchProtectionRule } from "@/db/schema/auth";

// A rule's pattern matches a branch name. Supported shapes:
//   "main"       - exact branch
//   "feature/*"  - prefix wildcard (git refspec style)
//   "*"          - every branch
// Patterns without a wildcard match exactly; wildcard only at the end.
export function patternMatches(pattern: string, branch: string): boolean {
  if (pattern === "*") return true;
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === branch;
  if (star !== pattern.length - 1) return false; // wildcard only at the end
  const prefix = pattern.slice(0, -1);
  return prefix.length === 0 ? true : branch.startsWith(prefix);
}

// Most specific rule wins: exact > prefix length > "*". Returns undefined
// when no rule covers the branch.
export function findProtectionRule(rules: BranchProtectionRule[], branch: string): BranchProtectionRule | undefined {
  let best: BranchProtectionRule | undefined;
  let bestScore = -1;
  for (const rule of rules) {
    if (!patternMatches(rule.branchPattern, branch)) continue;
    let score: number;
    if (rule.branchPattern === "*") score = 0;
    else if (rule.branchPattern.endsWith("*")) score = rule.branchPattern.length - 1;
    else score = rule.branchPattern.length + 1000; // exact beats any wildcard
    if (score > bestScore) {
      bestScore = score;
      best = rule;
    }
  }
  return best;
}

export async function listProtectionRules(projectId: string): Promise<BranchProtectionRule[]> {
  return db.select().from(branchProtectionRules).where(eq(branchProtectionRules.projectId, projectId));
}

export async function createProtectionRule(projectId: string, input: NewBranchProtectionRule) {
  const rows = await db.insert(branchProtectionRules).values({ ...input, projectId }).returning();
  return rows[0];
}

export async function updateProtectionRule(projectId: string, ruleId: string, patch: Partial<BranchProtectionRule>) {
  const rows = await db
    .update(branchProtectionRules)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(branchProtectionRules.id, ruleId), eq(branchProtectionRules.projectId, projectId)))
    .returning();
  return rows[0];
}

export async function deleteProtectionRule(projectId: string, ruleId: string) {
  const rows = await db
    .delete(branchProtectionRules)
    .where(and(eq(branchProtectionRules.id, ruleId), eq(branchProtectionRules.projectId, projectId)))
    .returning({ id: branchProtectionRules.id });
  return rows.length > 0;
}

// Snapshot consumed by the pre-receive hook (hooks cannot query the DB).
// Format: one rule per block, blank line separated, key=value lines. This is
// deliberately NOT JSON: the hook runs as plain /bin/sh (no python/jq in the
// runtime image), so fields are parsed with shell string trimming. Patterns
// cannot contain "=" or newlines (validated by BRANCH_PATTERN_PATTERN).
export function rulesSnapshot(rules: BranchProtectionRule[]): string {
  const lines: string[] = [];
  for (const r of rules) {
    lines.push(`pattern=${r.branchPattern}`);
    lines.push(`requirePr=${r.requirePr}`);
    lines.push(`requiredApprovals=${r.requiredApprovals}`);
    lines.push(`blockOnRequestChanges=${r.blockOnRequestChanges}`);
    lines.push(`blockForcePush=${r.blockForcePush}`);
    lines.push(`blockDeletion=${r.blockDeletion}`);
    lines.push(`restrictPushUserIds=${(r.restrictPushUserIds ?? []).join(",")}`);
    lines.push(`restrictMergeUserIds=${(r.restrictMergeUserIds ?? []).join(",")}`);
    lines.push(`allowAdminBypass=${r.allowAdminBypass}`);
    lines.push("");
  }
  return lines.join("\n");
}
