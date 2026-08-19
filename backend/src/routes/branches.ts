import { AUDIT_EVENTS } from "@/constants/audit-events";
import { ERROR_CODES } from "@/constants/errors";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { requireProjectAccess, type AuthEnv } from "@/middleware/auth";
import { PROJECT_PERMISSIONS } from "@/constants/permissions";
import {
  createBranch,
  deleteBranch,
  gitErrorMessage,
  listBranches,
  resolveBranchRef,
  resolveDefaultBranch,
} from "@/modules/projects/git";
import { getProject, projectRepoPath } from "@/modules/projects/projects";
import { audit } from "@/lib/logger";
import { errorSchema, idParamSchema, messageSchema } from "./schemas/common";
import { BRANCH_NAME_MAX_LENGTH, BRANCH_NAME_PATTERN } from "@/constants/limits";

// Matches git check-ref-format --branch for practical names (check-ref-format
// remains the final authority at create time). The ".." sequence is rejected
// separately because the character class alone would allow it.
const branchNameSchema = z
  .string()
  .min(1)
  .max(BRANCH_NAME_MAX_LENGTH)
  .regex(new RegExp(BRANCH_NAME_PATTERN), "Invalid branch name")
  .refine((name: string) => !name.includes(".."), "Invalid branch name");

export const createBranchInputSchema = z.object({
  name: branchNameSchema,
  fromBranch: z.string().optional(),
});

export const branchListResponseSchema = z.object({
  data: z.object({ branches: z.array(z.string()) }),
});

const createBranchResponseSchema = z.object({ data: z.object({ name: z.string() }) });

// Authed web branch management: create/delete branches in the bare repo via
// git update-ref. Permission: push (admin bypasses). Branch protection rules
// (blockDeletion) are enforced once protection lands in Fase 6.
export const branchRoutes = new OpenAPIHono<AuthEnv>();

async function loadRepo(c: Parameters<typeof requireProjectAccess>[0], projectId: string) {
  const project = await getProject(projectId);
  if (!project) {
    return { response: c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Project not found" } }, 404) };
  }
  return { project, repoPath: projectRepoPath(project.id) };
}

branchRoutes.openapi(
  createRoute({
    method: "get",
    path: "/:id/branches",
    tags: ["Branches"],
    summary: "List branches (authed, push permission)",
    request: { params: idParamSchema },
    responses: {
      200: { description: "Branch list", content: { "application/json": { schema: branchListResponseSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const access = await requireProjectAccess(c, id, PROJECT_PERMISSIONS.PUSH.slug);
    if (access instanceof Response) return access as never;
    const repo = await loadRepo(c, id);
    if ("response" in repo) return repo.response as never;
    const branches = await listBranches(repo.repoPath).catch((err) => {
      // Empty repo (unborn HEAD) is a normal state for fresh projects: list
      // nothing instead of failing. Anything else bubbles up to onError.
      const message = gitErrorMessage(err);
      if (/unborn|unknown revision|needed a single revision/i.test(message)) return [];
      throw err;
    });
    return c.json({ data: { branches } });
  }
);

branchRoutes.openapi(
  createRoute({
    method: "post",
    path: "/:id/branches",
    tags: ["Branches"],
    summary: "Create a branch from a ref (default HEAD)",
    request: {
      params: idParamSchema,
      body: { content: { "application/json": { schema: createBranchInputSchema } } },
    },
    responses: {
      201: { description: "Created branch", content: { "application/json": { schema: createBranchResponseSchema } } },
      400: { description: "Invalid branch", content: { "application/json": { schema: errorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const { name, fromBranch } = c.req.valid("json");
    const access = await requireProjectAccess(c, id, PROJECT_PERMISSIONS.PUSH.slug);
    if (access instanceof Response) return access as never;
    const repo = await loadRepo(c, id);
    if ("response" in repo) return repo.response as never;

    try {
      if (await resolveBranchRef(repo.repoPath, name)) {
        return c.json({ error: { code: ERROR_CODES.BRANCH_EXISTS, message: `Branch "${name}" already exists` } }, 400) as never;
      }
      const fromRef = fromBranch ?? "HEAD";
      await createBranch(repo.repoPath, name, fromRef);
      audit(AUDIT_EVENTS.BRANCH_CREATE, {
        projectId: id,
        projectName: repo.project.name,
        branch: name,
        fromRef,
        by: access.user.email,
      });
      return c.json({ data: { name } }, 201);
    } catch (err) {
      const message = gitErrorMessage(err);
      if (/not a valid branch name/i.test(message)) {
        return c.json({ error: { code: ERROR_CODES.INVALID_BRANCH_NAME, message: `Invalid branch name: "${name}"` } }, 400) as never;
      }
      if (/cannot lock ref|already exists/i.test(message)) {
        return c.json({ error: { code: ERROR_CODES.BRANCH_EXISTS, message: `Branch "${name}" already exists` } }, 400) as never;
      }
      if (/unknown revision|not a valid object|bad revision|needed a single revision/i.test(message)) {
        return c.json({ error: { code: ERROR_CODES.BAD_REQUEST, message: `Source ref "${fromBranch ?? "HEAD"}" not found or empty repo` } }, 400) as never;
      }
      throw err;
    }
  }
);

branchRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/:id/branches",
    tags: ["Branches"],
    summary: "Delete a branch by name query param (default branch is rejected)",
    // Branch names may contain slashes (feature/x), so the name travels as a
    // query param instead of a path segment (the router splits params on "/").
    request: {
      params: idParamSchema,
      query: z.object({ branch: branchNameSchema }),
    },
    responses: {
      200: { description: "Deleted", content: { "application/json": { schema: messageSchema } } },
      400: { description: "Invalid request", content: { "application/json": { schema: errorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const { branch } = c.req.valid("query");
    const access = await requireProjectAccess(c, id, PROJECT_PERMISSIONS.PUSH.slug);
    if (access instanceof Response) return access as never;
    const repo = await loadRepo(c, id);
    if ("response" in repo) return repo.response as never;

    const existing = await resolveBranchRef(repo.repoPath, branch);
    if (!existing) {
      return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: `Branch "${branch}" not found` } }, 404) as never;
    }
    const defaultBranch = await resolveDefaultBranch(repo.repoPath);
    if (defaultBranch === branch) {
      return c.json({ error: { code: ERROR_CODES.BAD_REQUEST, message: "The default branch cannot be deleted" } }, 400) as never;
    }
    await deleteBranch(repo.repoPath, branch);
    audit(AUDIT_EVENTS.BRANCH_DELETE, {
      projectId: id,
      projectName: repo.project.name,
      branch,
      by: access.user.email,
    });
    return c.json({ message: `Branch "${branch}" deleted` });
  }
);
