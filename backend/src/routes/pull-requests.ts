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
import {
  PR_STATUSES,
  PR_STATUS_SLUGS,
  PR_MERGEABLE_STATUS_SLUGS,
  MERGE_METHOD_SLUGS,
  REVIEW_STATE_SLUGS,
  type PrStatus,
} from "@/constants/pull-requests";
import { ERROR_CODES } from "@/constants/errors";
import { AUDIT_EVENTS } from "@/constants/audit-events";
import { PROJECT_PERMISSIONS } from "@/constants/permissions";
import { requireProjectAccess, type AuthEnv } from "@/middleware/auth";
import { getProject, projectRepoPath } from "@/modules/projects/projects";
import { getDiff } from "@/modules/projects/git";
import { prDiff, resolveRef, validatePrBranches } from "@/modules/pull-requests/pr";
import { mergePullRequest, refreshOpenPrMergeability, type MergeMethod } from "@/modules/pull-requests/merge";
import { MergeBlockedError, assertPrMergeAllowed } from "@/modules/pull-requests/protection";
import { audit } from "@/lib/logger";
import { sanitizeRichText } from "@/lib/sanitize";
import { errorSchema, idParamSchema, messageSchema } from "./schemas/common";

// Rich text fields carry HTML (Tiptap output). Sanitization is the server's
// job: every stored value passes through sanitizeRichText before insert or
// update, so the API response is safe to render verbatim on the frontend.
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

const prMergeInputSchema = z.object({
  method: z.enum(MERGE_METHOD_SLUGS).default("merge"),
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
  mergeableStatus: z.enum(PR_MERGEABLE_STATUS_SLUGS),
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
    mergeableStatus: row.mergeableStatus,
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

async function findPr(projectId: string, number: number) {
  const rows = await db.select().from(pullRequests).where(and(eq(pullRequests.projectId, projectId), eq(pullRequests.number, number)));
  return rows[0];
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
      description: body.description ? sanitizeRichText(body.description) : null,
      baseBranch: body.baseBranch,
      headBranch: body.headBranch,
      baseSha,
      headSha,
      authorId: access.user.id,
      status: PR_STATUSES.OPEN.slug,
    };
    const rows = await db.insert(pullRequests).values(input).returning();
    const pr = rows[0];
    // Trial merge right away so the create response already carries the badge.
    try {
      await refreshOpenPrMergeability(id, repo.repoPath);
    } catch {
      // stored status stays "unknown"; creation still succeeds
    }
    // The insert row predates the refresh, so re-read before responding.
    const refreshed = await db.select().from(pullRequests).where(eq(pullRequests.id, pr.id));
    audit(AUDIT_EVENTS.PULL_REQUEST_CREATE, {
      projectId: id,
      projectName: repo.project.name,
      prNumber: number,
      baseBranch: body.baseBranch,
      headBranch: body.headBranch,
      by: access.user.email,
    });
    return c.json({ data: toPr({ ...(refreshed[0] ?? pr), authorEmail: access.user.email }) }, 201);
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

    // Merged PRs keep showing the changes that were merged in. The base
    // branch now contains the head, so a plain base..head range is empty.
    // The stored merge commit is the source of truth for what the merge
    // brought in (parent..mergeCommit is exact for merge and squash). A
    // fast-forward merge only moves the base ref to the head tip, so the
    // merge commit diff would just be the last head commit; use the branch
    // snapshot stored at PR creation instead.
    if (pr.status === PR_STATUSES.MERGED.slug && pr.mergeCommitSha) {
      let fastForward = false;
      try {
        fastForward = (await resolveRef(repo.repoPath, pr.headBranch)) === pr.mergeCommitSha;
      } catch {
        // head branch deleted: fall through to the merge-commit diff
      }
      const diff = fastForward ? await getDiff(repo.repoPath, pr.baseSha, pr.headSha) : await prDiff(repo.repoPath, pr.mergeCommitSha);
      return c.json({ diff });
    }

    // Three-dot diff (base...head) fails on its own when a branch is missing
    // (unknown revision), so there is no need to resolve each ref first: the
    // extra spawns would triple the latency of opening a PR on Windows.
    try {
      const diff = await prDiff(repo.repoPath, pr.baseBranch, pr.headBranch);
      return c.json({ diff });
    } catch {
      return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Base or head branch no longer exists" } }, 404) as never;
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
        return c.json({ error: { code: ERROR_CODES.BAD_REQUEST, message: "Terminal pull requests cannot be reopened" } }, 400) as never;
      }
      if (![PR_STATUSES.ABANDONED.slug, PR_STATUSES.MERGED.slug, PR_STATUSES.REJECTED.slug].includes(body.status)) {
        return c.json({ error: { code: ERROR_CODES.BAD_REQUEST, message: `Invalid status transition to "${body.status}"` } }, 400) as never;
      }
    }

    const updated = await db
      .update(pullRequests)
      .set({
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: sanitizeRichText(body.description) } : {}),
        ...(body.status !== undefined ? { status: body.status as PrStatus, closedAt: body.status === PR_STATUSES.OPEN.slug ? null : new Date() } : {}),
      })
      .where(and(eq(pullRequests.projectId, id), eq(pullRequests.number, number)))
      .returning();
    const changed = updated[0];
    // Reopening is the only transition that invalidates the stored trial
    // result, so refresh it.
    if (body.status === PR_STATUSES.OPEN.slug) {
      try {
        await refreshOpenPrMergeability(id, repo.repoPath);
      } catch {
        // stored status stays as-is; the refresh is best effort
      }
    }
    // Audit only what actually changed: a status transition is its own event
    // (the feed renders "Changed status to Rejected"), edits of title or
    // description stay under pull_request.update with the edited fields.
    // No-ops (PATCH with the current status or identical text) produce no
    // audit entry at all, so the feed only ever shows real changes.
    const statusChanged = body.status !== undefined && body.status !== pr.status;
    const fields: string[] = [];
    if (body.title !== undefined && body.title !== pr.title) fields.push("title");
    if (body.description !== undefined && sanitizeRichText(body.description) !== pr.description) fields.push("description");
    if (statusChanged) {
      audit(AUDIT_EVENTS.PULL_REQUEST_STATUS_CHANGE, {
        projectId: id,
        projectName: repo.project.name,
        prNumber: number,
        from: pr.status,
        to: body.status,
        by: access.user.email,
      });
    } else if (fields.length > 0) {
      audit(AUDIT_EVENTS.PULL_REQUEST_UPDATE, {
        projectId: id,
        projectName: repo.project.name,
        prNumber: number,
        by: access.user.email,
        fields,
      });
    }
    const author = await db.select({ email: users.email }).from(users).where(eq(users.id, changed.authorId));
    return c.json({ data: toPr({ ...changed, authorEmail: author[0]?.email ?? "" }) });
  }
);

pullRequestRoutes.openapi(
  createRoute({
    method: "post",
    path: "/:id/pull-requests/:number/merge",
    tags: ["Pull requests"],
    summary: "Merge a pull request (push permission)",
    request: {
      params: idParamSchema.extend({ number: z.coerce.number().int().positive() }),
      body: { content: { "application/json": { schema: prMergeInputSchema } } },
    },
    responses: {
      200: { description: "Merged PR", content: { "application/json": { schema: prCreatedResponse } } },
      400: { description: "Invalid PR", content: { "application/json": { schema: errorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
      409: { description: "Merge conflict", content: { "application/json": { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { id, number } = c.req.valid("param");
    const { method } = c.req.valid("json");
    const access = await requireProjectAccess(c, id, PROJECT_PERMISSIONS.PUSH.slug);
    if (access instanceof Response) return access as never;
    const repo = await loadProject(c, id);
    if ("response" in repo) return repo.response as never;

    const rows = await db.select().from(pullRequests).where(and(eq(pullRequests.projectId, id), eq(pullRequests.number, number)));
    const pr = rows[0];
    if (!pr) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Pull request not found" } }, 404) as never;
    if (pr.status !== PR_STATUSES.OPEN.slug) {
      return c.json({ error: { code: ERROR_CODES.BAD_REQUEST, message: "Only open pull requests can be merged" } }, 400) as never;
    }

    // Branch protection gates (approvals, request-changes, merge whitelist,
    // admin bypass) are enforced here; the pre-receive hook cannot see the DB.
    try {
      await assertPrMergeAllowed(id, pr, access.user.id);
    } catch (err) {
      if (err instanceof MergeBlockedError) {
        return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: err.message } }, 403) as never;
      }
      throw err;
    }

    const result = await mergePullRequest(repo.repoPath, pr.baseBranch, pr.headBranch, method as MergeMethod);
    if (!result.ok) {
      if (result.conflict) {
        return c.json({ error: { code: ERROR_CODES.CONFLICT, message: result.error } }, 409) as never;
      }
      return c.json({ error: { code: ERROR_CODES.BAD_REQUEST, message: result.error } }, 400) as never;
    }

    const updated = await db
      .update(pullRequests)
      .set({
        status: PR_STATUSES.MERGED.slug,
        mergeMethod: method,
        mergeCommitSha: result.mergeCommitSha,
        mergedById: access.user.id,
        mergedAt: new Date(),
        closedAt: new Date(),
      })
      .where(eq(pullRequests.id, pr.id))
      .returning();
    const changed = updated[0];
    // The base branch moved: other open PRs aimed at it may now be stale.
    refreshOpenPrMergeability(id, repo.repoPath).catch(() => {});
    audit(AUDIT_EVENTS.PULL_REQUEST_MERGE, {
      projectId: id,
      projectName: repo.project.name,
      prNumber: number,
      method,
      mergeCommitSha: result.mergeCommitSha,
      by: access.user.email,
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

    // Terminal PRs keep their conversation (merged/abandoned/rejected history
    // is read-only), so only open PRs can be deleted. This mirrors the
    // comments/reviews guard and protects merged history from being lost.
    const rows = await db.select().from(pullRequests).where(and(eq(pullRequests.projectId, id), eq(pullRequests.number, number)));
    const pr = rows[0];
    if (!pr) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Pull request not found" } }, 404) as never;
    if (pr.status !== PR_STATUSES.OPEN.slug) {
      return c.json({ error: { code: ERROR_CODES.BAD_REQUEST, message: "Only open pull requests can be deleted" } }, 400) as never;
    }

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

const prCommentInputSchema = z.object({
  // Trim only to catch a fully-empty body; rich text keeps its internal
  // markup ("<p></p>" is a valid Tiptap empty state).
  body: z.string().trim().min(1).max(10000),
});

// Post a conversation comment on the PR (push permission). Only open PRs
// accept new messages; terminal PRs are read-only.
pullRequestRoutes.openapi(
  createRoute({
    method: "post",
    path: "/:id/pull-requests/:number/comments",
    tags: ["Pull requests"],
    summary: "Add a comment to a pull request (push permission)",
    request: {
      params: idParamSchema.extend({ number: z.coerce.number().int().positive() }),
      body: { content: { "application/json": { schema: prCommentInputSchema } } },
    },
    responses: {
      201: { description: "Created comment", content: { "application/json": { schema: z.object({ data: prCommentSchema }).openapi("PrCommentResponse") } } },
      400: { description: "Invalid comment", content: { "application/json": { schema: errorSchema } } },
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

    const pr = await findPr(id, number);
    if (!pr) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Pull request not found" } }, 404) as never;
    if (pr.status !== PR_STATUSES.OPEN.slug) {
      return c.json({ error: { code: ERROR_CODES.BAD_REQUEST, message: "Only open pull requests accept comments" } }, 400) as never;
    }

    const rows = await db
      .insert(prComments)
      .values({ prId: pr.id, userId: access.user.id, body: sanitizeRichText(body.body) })
      .returning();
    const comment = rows[0];
    audit(AUDIT_EVENTS.PULL_REQUEST_COMMENT, {
      projectId: id,
      projectName: repo.project.name,
      prNumber: number,
      by: access.user.email,
    });
    return c.json(
      {
        data: {
          id: comment.id,
          body: comment.body,
          author: { id: access.user.id, email: access.user.email },
          createdAt: comment.createdAt.toISOString(),
        },
      },
      201
    );
  }
);

const prReviewInputSchema = z.object({
  state: z.enum(REVIEW_STATE_SLUGS),
  // Rich text HTML, sanitized on insert like comments and descriptions.
  body: z.string().max(10000).optional(),
});

// Submit a review (approve / request changes / comment). Every submission is
// a new row: reviews are conversation history, not mutable state (there is no
// edit or undo). Only open PRs accept reviews; terminal PRs are read-only.
pullRequestRoutes.openapi(
  createRoute({
    method: "post",
    path: "/:id/pull-requests/:number/reviews",
    tags: ["Pull requests"],
    summary: "Submit a review on a pull request (push permission)",
    request: {
      params: idParamSchema.extend({ number: z.coerce.number().int().positive() }),
      body: { content: { "application/json": { schema: prReviewInputSchema } } },
    },
    responses: {
      201: { description: "Created review", content: { "application/json": { schema: z.object({ data: prReviewSchema }).openapi("PrReviewResponse") } } },
      400: { description: "Invalid review", content: { "application/json": { schema: errorSchema } } },
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

    const pr = await findPr(id, number);
    if (!pr) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Pull request not found" } }, 404) as never;
    if (pr.status !== PR_STATUSES.OPEN.slug) {
      return c.json({ error: { code: ERROR_CODES.BAD_REQUEST, message: "Only open pull requests accept reviews" } }, 400) as never;
    }

    const rows = await db
      .insert(prReviews)
      .values({ prId: pr.id, userId: access.user.id, state: body.state, body: body.body ? sanitizeRichText(body.body) : null })
      .returning();
    const review = rows[0];
    audit(AUDIT_EVENTS.PULL_REQUEST_REVIEW, {
      projectId: id,
      projectName: repo.project.name,
      prNumber: number,
      state: body.state,
      by: access.user.email,
    });
    return c.json(
      {
        data: {
          id: review.id,
          state: review.state,
          body: review.body,
          author: { id: access.user.id, email: access.user.email },
          createdAt: review.createdAt.toISOString(),
        },
      },
      201
    );
  }
);
