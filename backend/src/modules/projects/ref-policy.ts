// Ref mutation policy for API paths that move refs without going through the
// git protocol. Pushes are covered by the generated pre-receive hook, but the
// hook only runs on receive-pack: the branch create/delete API calls git
// update-ref directly, so it has to apply the same rule set itself. The checks
// here mirror the hook's per-ref loop (installPreReceiveHook in ./git) so the
// two enforcement points cannot drift apart.
import { findProtectionRule } from "./branch-protection";
import type { BranchProtectionRule } from "@/db/schema/auth";

// delete: removes the ref. In the hook this is the newrev==ZERO path.
// create: points the ref at a commit it did not point at before, which is what
//         the hook sees for a new branch in a push.
export type RefMutationAction = "create" | "delete";

export type RefPolicyDecision = { allowed: true } | { allowed: false; message: string };

const ALLOWED: RefPolicyDecision = { allowed: true };

export function evaluateRefMutation(input: {
  rules: BranchProtectionRule[];
  branch: string;
  action: RefMutationAction;
  actorId: string;
}): RefPolicyDecision {
  const rule = findProtectionRule(input.rules, input.branch);
  if (!rule) return ALLOWED;

  if (input.action === "delete") {
    // The hook judges a deletion by blockDeletion alone: for a zero new value
    // it moves on before the requirePr and push whitelist checks run.
    if (rule.blockDeletion) {
      return { allowed: false, message: `Branch protection: deleting branch "${input.branch}" is not allowed` };
    }
    return ALLOWED;
  }

  // A created branch is a new ref, so the hook skips blockForcePush for it
  // (there is no old value to compare against) and applies requirePr and the
  // push whitelist. restrictPushUserIds holds user ids; the hook reads the same
  // id from GITPUSH_USER_ID.
  if (rule.requirePr) {
    return { allowed: false, message: `Branch protection: direct writes to "${input.branch}" are not allowed; open a pull request` };
  }
  const allowedPushUsers = rule.restrictPushUserIds ?? [];
  if (allowedPushUsers.length > 0 && !allowedPushUsers.includes(input.actorId)) {
    return { allowed: false, message: `Branch protection: you are not allowed to write to "${input.branch}"` };
  }
  return ALLOWED;
}
