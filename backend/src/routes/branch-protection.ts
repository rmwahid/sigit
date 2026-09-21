// Branch protection rules CRUD (Fase 6). Reading a rule set needs view
// permission; creating/updating/deleting is admin only, like the other
// governance actions (backup, restore, collaborators, public toggle, delete).
// It deliberately does NOT accept the push permission: requirePr and
// restrictPushUserIds constrain push-capable principals, so gating on push let
// exactly the population the rules exclude edit or delete their own rule. The
// rules are enforced by the git pre-receive hook, which consumes a snapshot
// written alongside the bare repo (hooks cannot reach the DB).
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { branchProtectionRules } from "@/db/schema/auth";
import { AUDIT_EVENTS } from "@/constants/audit-events";
import { ERROR_CODES } from "@/constants/errors";
import { PROJECT_PERMISSIONS } from "@/constants/permissions";
import {
  BRANCH_PATTERN_MAX_LENGTH,
  BRANCH_PATTERN_PATTERN,
  MAX_PROTECTION_REQUIRED_APPROVALS,
} from "@/constants/limits";
import { requireAdmin, requireProjectAccess, type AuthEnv } from "@/middleware/auth";
import { getProject, projectRepoPath } from "@/modules/projects/projects";
import {
  createProtectionRule,
  deleteProtectionRule,
  listProtectionRules,
  rulesSnapshot,
  updateProtectionRule,
} from "@/modules/projects/branch-protection";
import { writeProtectionSnapshot } from "@/modules/projects/protection-snapshot";
import { audit } from "@/lib/logger";
import { errorSchema, idParamSchema, messageSchema } from "./schemas/common";

const branchPatternSchema = z
  .string()
  .min(1)
  .max(BRANCH_PATTERN_MAX_LENGTH)
  .regex(new RegExp(BRANCH_PATTERN_PATTERN), "Invalid branch pattern")
  .refine((p: string) => !p.includes(".."), "Invalid branch pattern");

const protectionInputSchema = z.object({
  branchPattern: branchPatternSchema,
  requirePr: z.boolean().default(false),
  requiredApprovals: z.number().int().min(0).max(MAX_PROTECTION_REQUIRED_APPROVALS).default(0),
  blockOnRequestChanges: z.boolean().default(false),
  blockForcePush: z.boolean().default(true),
  blockDeletion: z.boolean().default(true),
  restrictPushUserIds: z.array(z.string().uuid()).default([]),
  restrictMergeUserIds: z.array(z.string().uuid()).default([]),
  allowAdminBypass: z.boolean().default(false),
});

// The update schema must not carry defaults. With .default() on a field,
// .partial() still materialises that default for an omitted key, so a one-key
// PATCH body arrives at the handler with every other field already filled in and
// the handler's own "!== undefined" guards cannot tell the difference. Keeping
// .partial() over a default-free object makes an omitted field stay omitted.
const protectionPatchSchema = z
  .object({
    branchPattern: branchPatternSchema,
    requirePr: z.boolean(),
    requiredApprovals: z.number().int().min(0).max(MAX_PROTECTION_REQUIRED_APPROVALS),
    blockOnRequestChanges: z.boolean(),
    blockForcePush: z.boolean(),
    blockDeletion: z.boolean(),
    restrictPushUserIds: z.array(z.string().uuid()),
    restrictMergeUserIds: z.array(z.string().uuid()),
    allowAdminBypass: z.boolean(),
  })
  .partial();

const protectionRuleSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  branchPattern: z.string(),
  requirePr: z.boolean(),
  requiredApprovals: z.number().int(),
  blockOnRequestChanges: z.boolean(),
  blockForcePush: z.boolean(),
  blockDeletion: z.boolean(),
  restrictPushUserIds: z.array(z.string().uuid()),
  restrictMergeUserIds: z.array(z.string().uuid()),
  allowAdminBypass: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const ruleListResponse = z.object({ data: z.array(protectionRuleSchema) }).openapi("BranchProtectionListResponse");
const ruleResponse = z.object({ data: protectionRuleSchema }).openapi("BranchProtectionRuleResponse");

export const branchProtectionRoutes = new OpenAPIHono<AuthEnv>();

async function loadProject(c: Parameters<typeof requireProjectAccess>[0], projectId: string) {
  const project = await getProject(projectId);
  if (!project) {
    return { response: c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Project not found" } }, 404) };
  }
  return { project, repoPath: projectRepoPath(project.id) };
}

function toRule(row: typeof branchProtectionRules.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    branchPattern: row.branchPattern,
    requirePr: row.requirePr,
    requiredApprovals: row.requiredApprovals,
    blockOnRequestChanges: row.blockOnRequestChanges,
    blockForcePush: row.blockForcePush,
    blockDeletion: row.blockDeletion,
    restrictPushUserIds: row.restrictPushUserIds ?? [],
    restrictMergeUserIds: row.restrictMergeUserIds ?? [],
    allowAdminBypass: row.allowAdminBypass,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Keeps the hook snapshot in sync after any rule change.
async function refreshSnapshot(projectId: string, repoPath: string) {
  const rules = await listProtectionRules(projectId);
  await writeProtectionSnapshot(repoPath, rulesSnapshot(rules));
}

branchProtectionRoutes.openapi(
  createRoute({
    method: "get",
    path: "/:id/branch-protection",
    tags: ["Branch protection"],
    summary: "List branch protection rules (view permission)",
    request: { params: idParamSchema },
    responses: {
      200: { description: "Rules", content: { "application/json": { schema: ruleListResponse } } },
      404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const access = await requireProjectAccess(c, id, PROJECT_PERMISSIONS.VIEW.slug);
    if (access instanceof Response) return access as never;
    const repo = await loadProject(c, id);
    if ("response" in repo) return repo.response as never;
    const rules = await listProtectionRules(id);
    return c.json({ data: rules.map(toRule) });
  }
);

branchProtectionRoutes.openapi(
  createRoute({
    method: "post",
    path: "/:id/branch-protection",
    tags: ["Branch protection"],
    summary: "Create a branch protection rule (admin only)",
    request: {
      params: idParamSchema,
      body: { required: true, content: { "application/json": { schema: protectionInputSchema } } },
    },
    responses: {
      201: { description: "Created rule", content: { "application/json": { schema: ruleResponse } } },
      400: { description: "Invalid rule", content: { "application/json": { schema: errorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "Admin only" } }, 403) as never;
    const repo = await loadProject(c, id);
    if ("response" in repo) return repo.response as never;

    // Duplicate pattern check: query the full rule list and compare patterns.
    const rules = await listProtectionRules(id);
    if (rules.some((r) => r.branchPattern === body.branchPattern)) {
      return c.json({ error: { code: ERROR_CODES.BAD_REQUEST, message: `A rule for "${body.branchPattern}" already exists` } }, 400) as never;
    }

    const rule = await createProtectionRule(id, {
      projectId: id,
      branchPattern: body.branchPattern,
      requirePr: body.requirePr,
      requiredApprovals: body.requiredApprovals,
      blockOnRequestChanges: body.blockOnRequestChanges,
      blockForcePush: body.blockForcePush,
      blockDeletion: body.blockDeletion,
      restrictPushUserIds: body.restrictPushUserIds.length ? body.restrictPushUserIds : null,
      restrictMergeUserIds: body.restrictMergeUserIds.length ? body.restrictMergeUserIds : null,
      allowAdminBypass: body.allowAdminBypass,
    });
    await refreshSnapshot(id, repo.repoPath);
    audit(AUDIT_EVENTS.PROTECTION_CREATE, {
      projectId: id,
      projectName: repo.project.name,
      branchPattern: body.branchPattern,
      by: admin.email,
    });
    return c.json({ data: toRule(rule) }, 201);
  }
);

branchProtectionRoutes.openapi(
  createRoute({
    method: "patch",
    path: "/:id/branch-protection/:ruleId",
    tags: ["Branch protection"],
    summary: "Update a branch protection rule (admin only)",
    request: {
      params: idParamSchema.extend({ ruleId: z.string().uuid() }),
      body: { required: true, content: { "application/json": { schema: protectionPatchSchema } } },
    },
    responses: {
      200: { description: "Updated rule", content: { "application/json": { schema: ruleResponse } } },
      400: { description: "Invalid rule", content: { "application/json": { schema: errorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { id, ruleId } = c.req.valid("param");
    const body = c.req.valid("json");
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "Admin only" } }, 403) as never;
    const repo = await loadProject(c, id);
    if ("response" in repo) return repo.response as never;

    const patch: Record<string, unknown> = {};
    if (body.branchPattern !== undefined) patch.branchPattern = body.branchPattern;
    if (body.requirePr !== undefined) patch.requirePr = body.requirePr;
    if (body.requiredApprovals !== undefined) patch.requiredApprovals = body.requiredApprovals;
    if (body.blockOnRequestChanges !== undefined) patch.blockOnRequestChanges = body.blockOnRequestChanges;
    if (body.blockForcePush !== undefined) patch.blockForcePush = body.blockForcePush;
    if (body.blockDeletion !== undefined) patch.blockDeletion = body.blockDeletion;
    if (body.restrictPushUserIds !== undefined) patch.restrictPushUserIds = body.restrictPushUserIds.length ? body.restrictPushUserIds : null;
    if (body.restrictMergeUserIds !== undefined) patch.restrictMergeUserIds = body.restrictMergeUserIds.length ? body.restrictMergeUserIds : null;
    if (body.allowAdminBypass !== undefined) patch.allowAdminBypass = body.allowAdminBypass;

    const rule = await updateProtectionRule(id, ruleId, patch as never);
    if (!rule) {
      return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Rule not found" } }, 404) as never;
    }
    await refreshSnapshot(id, repo.repoPath);
    audit(AUDIT_EVENTS.PROTECTION_UPDATE, {
      projectId: id,
      projectName: repo.project.name,
      ruleId,
      by: admin.email,
    });
    return c.json({ data: toRule(rule) });
  }
);

branchProtectionRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/:id/branch-protection/:ruleId",
    tags: ["Branch protection"],
    summary: "Delete a branch protection rule (admin only)",
    request: { params: idParamSchema.extend({ ruleId: z.string().uuid() }) },
    responses: {
      200: { description: "Deleted", content: { "application/json": { schema: messageSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { id, ruleId } = c.req.valid("param");
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "Admin only" } }, 403) as never;
    const repo = await loadProject(c, id);
    if ("response" in repo) return repo.response as never;

    const ok = await deleteProtectionRule(id, ruleId);
    if (!ok) {
      return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Rule not found" } }, 404) as never;
    }
    await refreshSnapshot(id, repo.repoPath);
    audit(AUDIT_EVENTS.PROTECTION_DELETE, {
      projectId: id,
      projectName: repo.project.name,
      ruleId,
      by: admin.email,
    });
    return c.json({ message: "Branch protection rule deleted" });
  }
);
