import { AUDIT_EVENTS } from "@/constants/audit-events";
import { ERROR_CODES } from "@/constants/errors";
import { DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT } from "@/constants/limits";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { db } from "@/config/db";
import { getCommitFiles, getDiff } from "@/modules/projects/git";
import { backupProject, restoreProject } from "@/modules/projects/backup";
import { getConnection } from "@/modules/storage/connections";
import { requireAdmin, requireUser, type AuthEnv } from "@/middleware/auth";
import { projectCollaborators, users } from "@/db/schema/auth";
import { ADMIN_ROLE } from "@/constants/roles";
import { audit } from "@/lib/logger";
import { errorSchema, idParamSchema, idResponse, messageSchema } from "./schemas/common";
import {
  createProject,
  createProjectWithConnection,
  getProject,
  projectHistory,
  updateProject,
  projectRepoPath,
  hardDeleteProject,
} from "@/modules/projects/projects";
import {
  ALL_PROJECT_PERMISSIONS,
  getProjectAccess,
  hasPermission,
  isSiteAdmin,
  listAccessibleProjects,
  normalizePermissions,
  type ProjectPermission,
} from "@/modules/auth/access";
import {
  projectSchema,
  projectInputSchema,
  projectUpdateSchema,
  projectWithConnectionSchema,
  projectListResponse,
  projectResponse,
  historyResponse,
  diffResponse,
  backupResponse,
  historyQuerySchema,
  diffParamSchema,
} from "./schemas/projects";
import type { Project } from "@/db/schema/projects";

export const projectRoutes = new OpenAPIHono<AuthEnv>();

// API responses must never expose the per-project encryption key columns.
function toProjectResponse(p: Project) {
  const { encryptionKeyEncrypted: _key, encryptionKeyId: _keyId, ...safe } = p;
  return safe;
}

// 403 guard for actions that require a specific permission (admin bypasses).
async function requireProjectPermission(
  c: Parameters<typeof requireUser>[0],
  projectId: string,
  perm: ProjectPermission
): Promise<{ user: NonNullable<Awaited<ReturnType<typeof requireUser>>>; access: ProjectPermission[] | null } | Response> {
  const user = await requireUser(c);
  if (!user) return c.json({ error: { code: ERROR_CODES.UNAUTHORIZED, message: "Unauthorized" } }, 401);
  const access = await getProjectAccess(user.id, projectId);
  if (!hasPermission(access, perm)) {
    return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "No access to this project" } }, 403);
  }
  return { user, access };
}

projectRoutes.openapi(
  createRoute({
    method: "get",
    path: "/",
    tags: ["Projects"],
    summary: "List projects",
    responses: {
      200: {
        description: "List of projects",
        content: { "application/json": { schema: projectListResponse } },
      },
    },
  }),
  async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: { code: ERROR_CODES.UNAUTHORIZED, message: "Unauthorized" } }, 401) as never;
    const data = await listAccessibleProjects(user.id);
    return c.json({ data: data.map(toProjectResponse) });
  }
);

projectRoutes.openapi(
  createRoute({
    method: "post",
    path: "/",
    tags: ["Projects"],
    summary: "Create a project",
    request: {
      body: { content: { "application/json": { schema: projectInputSchema } } },
    },
    responses: {
      201: {
        description: "Created project",
        content: { "application/json": { schema: projectResponse } },
      },
    },
  }),
  async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: { code: ERROR_CODES.UNAUTHORIZED, message: "Unauthorized" } }, 401) as never;
    const body = c.req.valid("json");
    const project = await createProject(body);
    // Non-admin creators become collaborators with full (non-management) access.
    if (!isSiteAdmin(user)) {
      await db.insert(projectCollaborators).values({
        projectId: project.id,
        userId: user.id,
        permissions: [...ALL_PROJECT_PERMISSIONS],
      });
    }
    return c.json({ data: toProjectResponse(project) }, 201);
  }
);

projectRoutes.openapi(
  createRoute({
    method: "post",
    path: "/with-connection",
    tags: ["Projects"],
    summary: "Create a project together with a new storage connection",
    request: {
      body: { content: { "application/json": { schema: projectWithConnectionSchema } } },
    },
    responses: {
      201: {
        description: "Created project + connection",
        content: { "application/json": { schema: projectResponse } },
      },
    },
  }),
  async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: { code: ERROR_CODES.UNAUTHORIZED, message: "Unauthorized" } }, 401) as never;
    const body = c.req.valid("json");
    const { project } = await createProjectWithConnection(body);
    if (!isSiteAdmin(user)) {
      await db.insert(projectCollaborators).values({
        projectId: project.id,
        userId: user.id,
        permissions: [...ALL_PROJECT_PERMISSIONS],
      });
    }
    audit(AUDIT_EVENTS.PROJECT_CREATE_WITH_CONNECTION, { projectId: project.id, name: project.name });
    return c.json({ data: toProjectResponse(project) }, 201);
  }
);

projectRoutes.openapi(
  createRoute({
    method: "get",
    path: "/{id}",
    tags: ["Projects"],
    summary: "Get a project",
    request: { params: idParamSchema },
    responses: {
      200: {
        description: "Project detail",
        content: { "application/json": { schema: projectResponse } },
      },
      404: {
        description: "Not found",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const guard = await requireProjectPermission(c, c.req.valid("param").id, "view");
    if (guard instanceof Response) return guard as never;
    const { id } = c.req.valid("param");
    const project = await getProject(id);
    if (!project) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Not found" } }, 404);
    // myPermissions: null = admin (everything), otherwise the granted set.
    return c.json({ data: { ...toProjectResponse(project), myPermissions: guard.access } });
  }
);

projectRoutes.openapi(
  createRoute({
    method: "patch",
    path: "/{id}",
    tags: ["Projects"],
    summary: "Update a project",
    request: {
      params: idParamSchema,
      body: { content: { "application/json": { schema: projectUpdateSchema } } },
    },
    responses: {
      200: {
        description: "Updated project",
        content: { "application/json": { schema: projectResponse } },
      },
      404: {
        description: "Not found",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "Admin only" } }, 403) as never;
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const project = await updateProject(id, body);
    if (!project) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Not found" } }, 404);
    return c.json({ data: toProjectResponse(project) });
  }
);

projectRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/{id}",
    tags: ["Projects"],
    summary: "Delete a project",
    request: { params: idParamSchema },
    responses: {
      200: {
        description: "Deleted",
        content: { "application/json": { schema: idResponse } },
      },
      404: {
        description: "Not found",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "Admin only" } }, 403) as never;
    const { id } = c.req.valid("param");
    const result = await hardDeleteProject(id);
    if (!result.deletedDb) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Not found" } }, 404);
    audit(AUDIT_EVENTS.PROJECT_DELETE, { projectId: id, ...result });
    return c.json({ data: result });
  }
);

projectRoutes.openapi(
  createRoute({
    method: "get",
    path: "/{id}/history",
    tags: ["Projects"],
    summary: "Get project commit history",
    request: {
      params: idParamSchema,
      query: historyQuerySchema,
    },
    responses: {
      200: {
        description: "Project history",
        content: { "application/json": { schema: historyResponse } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const guard = await requireProjectPermission(c, id, "history");
    if (guard instanceof Response) return guard as never;
    const { limit, offset } = c.req.valid("query");
    const limitNum = Math.min(Math.max(Number(limit) || DEFAULT_HISTORY_LIMIT, 1), MAX_HISTORY_LIMIT);
    const offsetNum = Math.max(Number(offset) || 0, 0);
    const history = await projectHistory(id, limitNum, offsetNum);
    return c.json({ data: history });
  }
);

projectRoutes.openapi(
  createRoute({
    method: "get",
    path: "/{id}/history/{hash}/diff",
    tags: ["Projects"],
    summary: "Get diff of a commit",
    request: {
      params: diffParamSchema,
    },
    responses: {
      200: {
        description: "Commit diff",
        content: { "application/json": { schema: diffResponse } },
      },
      404: {
        description: "Not found",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { id, hash } = c.req.valid("param");
    const guard = await requireProjectPermission(c, id, "diff");
    if (guard instanceof Response) return guard as never;
    const project = await getProject(id);
    if (!project) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Not found" } }, 404);
    const repoPath = projectRepoPath(project.id);
    const diff = await getDiff(repoPath, hash);
    const files = await getCommitFiles(repoPath, hash);
    return c.json({ data: { diff, files } });
  }
);

projectRoutes.openapi(
  createRoute({
    method: "post",
    path: "/{id}/backup",
    tags: ["Projects"],
    summary: "Create and upload a git bundle backup to storage",
    request: { params: idParamSchema },
    responses: {
      200: {
        description: "Backup created",
        content: { "application/json": { schema: backupResponse } },
      },
      404: {
        description: "Not found",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "Admin only" } }, 403) as never;
    const { id } = c.req.valid("param");
    const project = await getProject(id);
    if (!project) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Not found" } }, 404);
    const result = await backupProject(project);
    audit(AUDIT_EVENTS.PROJECT_BACKUP, { projectId: id, key: result.key });
    return c.json({ data: result });
  }
);

projectRoutes.openapi(
  createRoute({
    method: "post",
    path: "/{id}/restore",
    tags: ["Projects"],
    summary: "Restore project from git bundle backup in storage",
    request: { params: idParamSchema },
    responses: {
      200: {
        description: "Restored",
        content: { "application/json": { schema: messageSchema } },
      },
      400: {
        description: "Project has no storage connection",
        content: { "application/json": { schema: errorSchema } },
      },
      404: {
        description: "Not found",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "Admin only" } }, 403) as never;
    const { id } = c.req.valid("param");
    const project = await getProject(id);
    if (!project) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Not found" } }, 404);
    if (!project.storageConnectionId) {
      return c.json({ error: { code: ERROR_CODES.BAD_REQUEST, message: "Project has no storage connection" } }, 400) as never;
    }
    const connection = await getConnection(project.storageConnectionId);
    if (!connection) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Storage connection not found" } }, 404) as never;
    await restoreProject(project, connection);
    audit(AUDIT_EVENTS.PROJECT_RESTORE, { projectId: id });
    return c.json({ message: "Restored" });
  }
);

// --- Collaborators (admin only) ---

const collaboratorSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  email: z.string().email(),
  permissions: z.array(z.enum(ALL_PROJECT_PERMISSIONS)),
});
const collaboratorListResponse = z.object({ data: z.array(collaboratorSchema) });
const collaboratorInput = z.object({
  userId: z.string().uuid(),
  permissions: z.array(z.enum(ALL_PROJECT_PERMISSIONS)),
});
const collaboratorUpdateInput = z.object({
  permissions: z.array(z.enum(ALL_PROJECT_PERMISSIONS)),
});

projectRoutes.openapi(
  createRoute({
    method: "get",
    path: "/{id}/collaborators",
    tags: ["Projects"],
    summary: "List project collaborators (admin only)",
    request: { params: idParamSchema },
    responses: {
      200: {
        description: "Collaborators with permissions",
        content: { "application/json": { schema: collaboratorListResponse } },
      },
    },
  }),
  async (c) => {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "Admin only" } }, 403) as never;
    const { id } = c.req.valid("param");
    const rows = await db
      .select({
        id: projectCollaborators.id,
        userId: projectCollaborators.userId,
        email: users.email,
        permissions: projectCollaborators.permissions,
      })
      .from(projectCollaborators)
      .innerJoin(users, eq(users.id, projectCollaborators.userId))
      .where(eq(projectCollaborators.projectId, id));
    return c.json({
      data: rows.map((r) => ({ ...r, permissions: normalizePermissions(r.permissions) })),
    });
  }
);

projectRoutes.openapi(
  createRoute({
    method: "post",
    path: "/{id}/collaborators",
    tags: ["Projects"],
    summary: "Add a collaborator with permissions (admin only)",
    request: {
      params: idParamSchema,
      body: { content: { "application/json": { schema: collaboratorInput } } },
    },
    responses: {
      201: {
        description: "Collaborator added",
        content: { "application/json": { schema: collaboratorSchema } },
      },
      404: {
        description: "Project or user not found",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "Admin only" } }, 403) as never;
    const { id } = c.req.valid("param");
    const { userId, permissions } = c.req.valid("json");
    const project = await getProject(id);
    if (!project) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Not found" } }, 404) as never;
    const target = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true, role: true, email: true },
    });
    if (!target || target.role === ADMIN_ROLE) {
      return c.json({ error: { code: ERROR_CODES.BAD_REQUEST, message: "User not found or is an admin" } }, 400) as never;
    }
    // Upsert: replace any existing collaborator row for this user.
    await db.delete(projectCollaborators).where(eq(projectCollaborators.userId, userId));
    const rows = await db
      .insert(projectCollaborators)
      .values({ projectId: id, userId, permissions: normalizePermissions(permissions) })
      .returning();
    const row = rows[0];
    audit(AUDIT_EVENTS.PROJECT_COLLABORATOR_ADD, { projectId: id, userId, by: admin.email });
    return c.json(
      {
        data: {
          id: row.id,
          userId: row.userId,
          email: target.email ?? "",
          permissions: normalizePermissions(row.permissions),
        },
      },
      201
    );
  }
);

projectRoutes.openapi(
  createRoute({
    method: "patch",
    path: "/{id}/collaborators/{userId}",
    tags: ["Projects"],
    summary: "Update collaborator permissions (admin only)",
    request: {
      params: z.object({ id: z.string().uuid(), userId: z.string().uuid() }),
      body: { content: { "application/json": { schema: collaboratorUpdateInput } } },
    },
    responses: {
      200: {
        description: "Updated collaborator",
        content: { "application/json": { schema: collaboratorSchema } },
      },
      404: {
        description: "Not found",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "Admin only" } }, 403) as never;
    const { id, userId } = c.req.valid("param");
    const { permissions } = c.req.valid("json");
    const rows = await db
      .update(projectCollaborators)
      .set({ permissions: normalizePermissions(permissions) })
      .where(eq(projectCollaborators.userId, userId))
      .returning();
    const row = rows[0];
    if (!row) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Not found" } }, 404) as never;
    audit(AUDIT_EVENTS.PROJECT_COLLABORATOR_UPDATE, { projectId: id, userId, by: admin.email });
    return c.json({ data: { id: row.id, userId: row.userId, email: "", permissions: normalizePermissions(row.permissions) } });
  }
);

projectRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/{id}/collaborators/{userId}",
    tags: ["Projects"],
    summary: "Remove a collaborator (admin only)",
    request: {
      params: z.object({ id: z.string().uuid(), userId: z.string().uuid() }),
    },
    responses: {
      200: {
        description: "Removed",
        content: { "application/json": { schema: messageSchema } },
      },
      404: {
        description: "Not found",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "Admin only" } }, 403) as never;
    const { userId } = c.req.valid("param");
    const rows = await db
      .delete(projectCollaborators)
      .where(eq(projectCollaborators.userId, userId))
      .returning();
    if (rows.length === 0) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Not found" } }, 404) as never;
    audit(AUDIT_EVENTS.PROJECT_COLLABORATOR_REMOVE, { userId, by: admin.email });
    return c.json({ message: "Removed" });
  }
);
