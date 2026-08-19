// Pull request routes (Fase 3): create/list/get/update/delete + diff preview.
// Permissions: creating/editing requires push; reading requires view; the diff
// endpoint requires the diff permission. Author joins and next-number
// allocation live here (the pr module stays DB-free).
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, desc, eq, max } from "drizzle-orm";
import { db } from "@/config/db";
import {
  prComments,
  prReviews,
  pullRequests,
  users,
  type NewPullRequest,
  type PullRequest,
} from "@/db/schema/auth";
import { PR_STATUSES, PR_STATUS_SLUGS, type PrStatus } from "@/constants/pull-requests";
import { ERROR_CODES } from "@/constants/errors";
import { AUDIT_EVENTS } from "@/constants/audit-events";
import { PROJECT_PERMISSIONS } from "@/constants/permissions";
import { requireProjectAccess, type AuthEnv } from "@/middleware/auth";
import { getProject, projectRepoPath } from "@/modules/projects/projects";
import { execGit, gitErrorMessage } from "@/modules/projects/git";
import { prDiff, validatePrBranches } from "@/modules/pull-requests/pr";
import { audit } from "@/lib/logger";
import { errorSchema, idParamSchema, messageSchema } from "./schemas/common";

const prInputSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(10000).optional(),
  baseBranch: z.string().min(1).max(255),
  headBranch: z.string().min(1).max(255),
});

const prUpdateSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(10000).optional(),
  status: z.enum(PR_STATUS_SLUGS).optional(),
});

const prAuthorSchema = z.object({ id: z.string().uuid(), email: z.string() });
const prCommentSchema = z.object({
  id: z.string().uuid(),
  body: z.string(),
  author: prAuthorSchema,
  createdAt: z.string().datetime(),
});
const prReviewSchema = z.object({
  id: z.string().uuid(),
  state: z.string(),
  body: z.string().nullable(),
  author: prAuthorSchema,
  createdAt: z.string().datetime(),
});
const prSchema = z.object({
  id: z.string().uuid(),
  number: z.number().int(),
  title: z.string(),
  description: z.string().nullable(),
  baseBranch: z.string(),
  headBranch: z.string(),
  baseSha: z.string(),
  headSha: z.string(),
  author: prAuthorSchema,
  status: z.enum(PR_STATUS_SLUGS),
  mergeMethod: z.string().nullable(),
  mergeCommitSha: z.string().nullable(),
  mergedById: z.string().uuid().nullable(),
  mergedAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
const prDetailSchema = prSchema.extend({
  comments: z.array(prCommentSchema),
  reviews: z.array(prReviewSchema),
});

const prListResponse = z.object({ data: z.array(prSchema) }).openapi("PrListResponse");
const prDetailResponse = z.object({ data: prDetailSchema }).openapi("PrDetailResponse");
const prCreatedResponse = z.object({ data: prSchema }).openapi("PrCreatedResponse");
const prDiffResponse = z.object({ diff: z.string() }).openapi("PrDiffResponse");

export const pullRequestRoutes = new OpenAPIHono<AuthEnv>();

type PrRow = PullRequest & { authorEmail: string };

async function loadProject(c: Parameters<typeof requireProjectAccess>[0], projectId: string) {
  const project = await getProject(projectId);
  if (!project) return { response: c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Project not found" } }, 404) };
  return { project, repoPath: projectRepoPath(project.id) };
}

function toPr(row: PrRow) {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    description: row.description,
    baseBranch: row.baseBranch,
    headBranch: row.headBranch,
    baseSha: row.baseSha,
    headSha: row.headSha,
    author: { id: row.authorId, email: row.authorEmail },
    status: row.status,
    mergeMethod: row.mergeMethod,
    mergeCommitSha: row.mergeCommitSha,
    mergedById: row.mergedById,
    mergedAt: row.mergedAt ? row.mergedAt.toISOString() : null,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function nextPrNumber(projectId: string): Promise<number> {
  const rows = await db.select({ n: max(pullRequests.number) }).from(pullRequests).where(eq(pullRequests.projectId, projectId));
  return (rows[0]?.n ?? 0) + 1;
}

async function resolveRef(repoPath: string, ref: string): Promise<string> {
  const { stdout } = await execGit(repoPath, ["rev-parse", "--verify", `refs/heads/${ref}^{commit}`]);
  return stdout.toString("utf8").trim();
}

async function loadPrDetail(projectId: string, number: number) {
  const rows = await db
    .select({
      pr: pullRequests,
      authorEmail: users.email,
    })
    .from(pullRequests)
    .innerJoin(users, eq(users.id, pullRequests.authorId))
    .where(and(eq(pullRequests.projectId, projectId), eq(pullRequests.number, number)));
  if (rows.length === 0) return null;
  const row = rows[0];
  const comments = await db
    .select({ id: prComments.id, body: prComments.body, authorId: prComments.userId, email: users.email, createdAt: prComments.createdAt })
    .from(prComments)
    .innerJoin(users, eq(users.id, prComments.userId))
    .where(eq(prComments.prId, row.pr.id))
    .orderBy(prComments.createdAt);
  const reviews = await db
    .select({ id: prReviews.id, state: prReviews.state, body: prReviews.body, authorId: prReviews.userId, email: users.email, createdAt: prReviews.createdAt })
    .from(prReviews)
    .innerJoin(users, eq(users.id, prReviews.userId))
    .where(eq(prReviews.prId, row.pr.id))
    .orderBy(prReviews.createdAt);
  return {
    pr: toPr({ ...row.pr, authorEmail: row.authorEmail }),
    comments: comments.map((c) => ({
      id: c.id,
      body: c.body,
      author: { id: c.authorId, email: c.email },
      createdAt: c.createdAt.toISOString(),
    })),
    reviews: reviews.map((r) => ({
      id: r.id,
      state: r.state,
      body: r.body,
      author: { id: r.authorId, email: r.email },
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

pullRequestRoutes.openapi(
  createRoute({
    method: "get",
    path: "/:id/pull-requests",
    tags: ["Pull requests"],
    summary: "List pull requests (view permission)",
    request: { params: idParamSchema, query: z.object({ status: z.enum(PR_STATUS_SLUGS).optional() }) },
    responses: {
      200: { description: "PR list", content: { "application/json": { schema: prListResponse } } },
      404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const { status } = c.req.valid("query");
    const access = await requireProjectAccess(c, id, PROJECT_PERMISSIONS.VIEW.slug);
    if (access instanceof Response) return access as never;
    const repo = await loadProject(c, id);
    if ("response" in repo) return repo.response as never;

    const rows = await db
      .select({ pr: pullRequests, authorEmail: users.email })
      .from(pullRequests)
      .innerJoin(users, eq(users.id, pullRequests.authorId))
      .where(and(eq(pullRequests.projectId, id), status ? eq(pullRequests.status, status) : undefined))
      .orderBy(desc(pullRequests.number));
    return c.json({ data: rows.map((r) => toPr({ ...r.pr, authorEmail: r.authorEmail })) });
  }
);

pullRequestRoutes.openapi(
  createRoute({
    method: "post",
    path: "/:id/pull-requests",
    tags: ["Pull requests"],
    summary: "Create a pull request (push permission)",
    request: { params: idParamSchema, body: { content: { "application/json": { schema: prInputSchema } } } },
    responses: {
      201: { description: "Created PR", content: { "application/json": { schema: prCreatedResponse } } },
      400: { description: "Invalid PR", content: { "application/json": { schema: errorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const access = await requireProjectAccess(c, id, PROJECT_PERMISSIONS.PUSH.slug);
    if (access instanceof Response) return access as never;
    const repo = await loadProject(c, id);
    if ("response" in repo) return repo.response as never;

    const validation = await validatePrBranches(repo.repoPath, body.baseBranch, body.headBranch);
    if (!validation.ok) {
      return c.json({ error: { code: ERROR_CODES.BAD_REQUEST, message: validation.error } }, 400) as never;
    }
    const [baseSha, headSha] = await Promise.all([
      resolveRef(repo.repoPath, body.baseBranch),
      resolveRef(repo.repoPath, body.headBranch),
    ]);
    const number = await nextPrNumber(id);
    const input: NewPullRequest = {
      projectId: id,
      number,
      title: body.title,
      description: body.description ?? null,
      baseBranch: body.baseBranch,
      headBranch: body.headBranch,
      baseSha,
      headSha,
      authorId: access.user.id,
      status: PR_STATUSES.OPEN.slug,
    };
    const rows = await db.insert(pullRequests).values(input).returning();
    const pr = rows[0];
    audit(AUDIT_EVENTS.PULL_REQUEST_CREATE, {
      projectId: id,
      projectName: repo.project.name,
      prNumber: number,
      baseBranch: body.baseBranch,
      headBranch: body.headBranch,
      by: access.user.email,
    });
    return c.json({ data: toPr({ ...pr, authorEmail: access.user.email }) }, 201);
  }
);

pullRequestRoutes.openapi(
  createRoute({
    method: "get",
    path: "/:id/pull-requests/:number",
    tags: ["Pull requests"],
    summary: "Get a pull request with comments and reviews (view permission)",
    request: { params: idParamSchema.extend({ number: z.coerce.number().int().positive() }) },
    responses: {
      200: { description: "PR detail", content: { "application/json": { schema: prDetailResponse } } },
      404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { id, number } = c.req.valid("param");
    const access = await requireProjectAccess(c, id, PROJECT_PERMISSIONS.VIEW.slug);
    if (access instanceof Response) return access as never;
    const repo = await loadProject(c, id);
    if ("response" in repo) return repo.response as never;

    const detail = await loadPrDetail(id, number);
    if (!detail) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Pull request not found" } }, 404) as never;
    return c.json({ data: { ...detail.pr, comments: detail.comments, reviews: detail.reviews } });
  }
);

pullRequestRoutes.openapi(
  createRoute({
    method: "get",
    path: "/:id/pull-requests/:number/diff",
    tags: ["Pull requests"],
    summary: "Get the raw diff between base and head (diff permission)",
    request: { params: idParamSchema.extend({ number: z.coerce.number().int().positive() }) },
    responses: {
      200: { description: "Raw diff", content: { "application/json": { schema: prDiffResponse } } },
      404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { id, number } = c.req.valid("param");
    const access = await requireProjectAccess(c, id, PROJECT_PERMISSIONS.DIFF.slug);
    if (access instanceof Response) return access as never;
    const repo = await loadProject(c, id);
    if ("response" in repo) return repo.response as never;

    const rows = await db.select().from(pullRequests).where(and(eq(pullRequests.projectId, id), eq(pullRequests.number, number)));
    const pr = rows[0];
    if (!pr) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Pull request not found" } }, 404) as never;
    try {
      const diff = await prDiff(repo.repoPath, pr.baseBranch, pr.headBranch);
      return c.json({ diff });
    } catch (err) {
      const message = gitErrorMessage(err);
      if (/unknown revision|bad revision|no merge base/i.test(message)) {
        return c.json({ error: { code: ERROR_CODES.BAD_REQUEST, message: "Base or head branch no longer exists" } }, 400) as never;
      }
      throw err;
    }
  }
);

pullRequestRoutes.openapi(
  createRoute({
    method: "patch",
    path: "/:id/pull-requests/:number",
    tags: ["Pull requests"],
    summary: "Update title/description or status (push permission)",
    request: {
      params: idParamSchema.extend({ number: z.coerce.number().int().positive() }),
      body: { content: { "application/json": { schema: prUpdateSchema } } },
    },
    responses: {
      200: { description: "Updated PR", content: { "application/json": { schema: prCreatedResponse } } },
      400: { description: "Invalid PR", content: { "application/json": { schema: errorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { id, number } = c.req.valid("param");
    const body = c.req.valid("json");
    const access = await requireProjectAccess(c, id, PROJECT_PERMISSIONS.PUSH.slug);
    if (access instanceof Response) return access as never;
    const repo = await loadProject(c, id);
    if ("response" in repo) return repo.response as never;

    const rows = await db.select().from(pullRequests).where(and(eq(pullRequests.projectId, id), eq(pullRequests.number, number)));
    const pr = rows[0];
    if (!pr) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Pull request not found" } }, 404) as never;

    if (body.status && body.status !== pr.status) {
      if (pr.status !== PR_STATUSES.OPEN.slug) {
        return c.json({ error: { code: ERROR_CODES.BAD_REQUEST, message: "Closed or merged pull requests cannot be reopened" } }, 400) as never;
      }
      if (![PR_STATUSES.CLOSED.slug, PR_STATUSES.MERGED.slug, PR_STATUSES.REJECTED.slug].includes(body.status)) {
        return c.json({ error: { code: ERROR_CODES.BAD_REQUEST, message: `Invalid status transition to "${body.status}"` } }, 400) as never;
      }
    }

    const updated = await db
      .update(pullRequests)
      .set({
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.status !== undefined ? { status: body.status as PrStatus, closedAt: body.status === PR_STATUSES.OPEN.slug ? null : new Date() } : {}),
      })
      .where(and(eq(pullRequests.projectId, id), eq(pullRequests.number, number)))
      .returning();
    const changed = updated[0];
    audit(AUDIT_EVENTS.PULL_REQUEST_UPDATE, {
      projectId: id,
      projectName: repo.project.name,
      prNumber: number,
      by: access.user.email,
      changes: body,
    });
    const author = await db.select({ email: users.email }).from(users).where(eq(users.id, changed.authorId));
    return c.json({ data: toPr({ ...changed, authorEmail: author[0]?.email ?? "" }) });
  }
);

pullRequestRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/:id/pull-requests/:number",
    tags: ["Pull requests"],
    summary: "Delete a pull request (push permission)",
    request: { params: idParamSchema.extend({ number: z.coerce.number().int().positive() }) },
    responses: {
      200: { description: "Deleted", content: { "application/json": { schema: messageSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { id, number } = c.req.valid("param");
    const access = await requireProjectAccess(c, id, PROJECT_PERMISSIONS.PUSH.slug);
    if (access instanceof Response) return access as never;
    const repo = await loadProject(c, id);
    if ("response" in repo) return repo.response as never;

    const deleted = await db
      .delete(pullRequests)
      .where(and(eq(pullRequests.projectId, id), eq(pullRequests.number, number)))
      .returning({ id: pullRequests.id });
    if (deleted.length === 0) {
      return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Pull request not found" } }, 404) as never;
    }
    audit(AUDIT_EVENTS.PULL_REQUEST_DELETE, {
      projectId: id,
      projectName: repo.project.name,
      prNumber: number,
      by: access.user.email,
    });
    return c.json({ message: `Pull request #${number} deleted` });
  }
);
