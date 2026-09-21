// Paired test for modules/projects/ref-policy.ts: the API-side mirror of the
// pre-receive hook's per-ref checks. Each case states which hook check it
// stands for, so a change to the hook has an obvious counterpart here.
import { describe, expect, it } from "bun:test";
import { evaluateRefMutation, type RefPolicyDecision } from "@/modules/projects/ref-policy";
import type { BranchProtectionRule } from "@/db/schema/auth";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const rule = (branchPattern: string, extra: Partial<BranchProtectionRule> = {}): BranchProtectionRule => ({
  id: "id",
  projectId: "pid",
  branchPattern,
  requirePr: false,
  requiredApprovals: 0,
  blockOnRequestChanges: false,
  blockForcePush: true,
  blockDeletion: true,
  restrictPushUserIds: null,
  restrictMergeUserIds: null,
  allowAdminBypass: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...extra,
});

const create = (rules: BranchProtectionRule[], branch: string): RefPolicyDecision =>
  evaluateRefMutation({ rules, branch, action: "create", actorId: ACTOR });
const remove = (rules: BranchProtectionRule[], branch: string): RefPolicyDecision =>
  evaluateRefMutation({ rules, branch, action: "delete", actorId: ACTOR });

function messageOf(decision: RefPolicyDecision): string {
  return decision.allowed ? "" : decision.message;
}

describe("evaluateRefMutation", () => {
  it("allows both actions when no rule covers the branch", () => {
    expect(create([], "main").allowed).toBe(true);
    expect(remove([], "main").allowed).toBe(true);
    expect(create([rule("main")], "feature/x").allowed).toBe(true);
    expect(remove([rule("main")], "feature/x").allowed).toBe(true);
  });

  it("refuses deleting a branch whose rule blocks deletion", () => {
    const decision = remove([rule("main", { blockDeletion: true })], "main");
    expect(decision.allowed).toBe(false);
    expect(messageOf(decision)).toContain("deleting branch");
  });

  it("allows deleting a branch whose rule leaves deletion open", () => {
    expect(remove([rule("main", { blockDeletion: false })], "main").allowed).toBe(true);
  });

  it("judges a deletion by blockDeletion alone, like the hook", () => {
    // The hook moves on before the requirePr and whitelist checks when the new
    // value is zero, so a deletion is not refused by those two fields.
    const rules = [rule("main", { blockDeletion: false, requirePr: true, restrictPushUserIds: [OTHER] })];
    expect(remove(rules, "main").allowed).toBe(true);
  });

  it("refuses creating a branch whose rule requires a pull request", () => {
    const decision = create([rule("release/*", { requirePr: true })], "release/1.0");
    expect(decision.allowed).toBe(false);
    expect(messageOf(decision)).toContain("pull request");
  });

  it("applies the push whitelist to a create", () => {
    expect(create([rule("wip/*", { restrictPushUserIds: [OTHER] })], "wip/x").allowed).toBe(false);
    expect(messageOf(create([rule("wip/*", { restrictPushUserIds: [OTHER] })], "wip/x"))).toContain("not allowed");
    expect(create([rule("wip/*", { restrictPushUserIds: [ACTOR] })], "wip/x").allowed).toBe(true);
    // An empty or unset whitelist restricts nobody (the hook only checks a
    // non-empty list).
    expect(create([rule("wip/*", { restrictPushUserIds: [] })], "wip/x").allowed).toBe(true);
    expect(create([rule("wip/*", { restrictPushUserIds: null })], "wip/x").allowed).toBe(true);
  });

  it("does not refuse a create for a rule that only blocks deletion", () => {
    expect(create([rule("main", { blockDeletion: true })], "main").allowed).toBe(true);
  });

  it("uses the most specific rule rather than any matching rule", () => {
    const rules = [rule("*", { requirePr: true }), rule("feature/x", { requirePr: false })];
    expect(create(rules, "feature/x").allowed).toBe(true);
    expect(create(rules, "feature/y").allowed).toBe(false);
  });
});
