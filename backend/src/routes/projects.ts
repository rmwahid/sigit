import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  createProject,
  createProjectWithConnection,
  getProject,
  listProjects,
  projectHistory,
  updateProject,
  projectRepoPath,
  hardDeleteProject,
} from "../modules/projects/projects";
import { getDiff, getCommitFiles } from "../modules/projects/git";
import { backupProject, restoreProject } from "../modules/projects/backup";
import { getConnection } from "../modules/storage/connections";
import { audit } from "../lib/logger";
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
import { errorSchema, idParamSchema, idResponse, messageSchema } from "./schemas/common";

export const projectRoutes = new OpenAPIHono();

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
    const data = await listProjects();
    return c.json({ data });
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
    const body = c.req.valid("json");
    const project = await createProject(body);
    return c.json({ data: project }, 201);
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
    const body = c.req.valid("json");
    const { project } = await createProjectWithConnection(body);
    audit("project.create_with_connection", { projectId: project.id, name: project.name });
    return c.json({ data: project }, 201);
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
    const { id } = c.req.valid("param");
    const project = await getProject(id);
    if (!project) return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    return c.json({ data: project });
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
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const project = await updateProject(id, body);
    if (!project) return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    return c.json({ data: project });
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
    const { id } = c.req.valid("param");
    const result = await hardDeleteProject(id);
    if (!result.deletedDb) return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    audit("project.delete", { projectId: id, ...result });
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
    const { limit } = c.req.valid("query");
    const history = await projectHistory(id, limit ? Number(limit) : undefined);
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
    const project = await getProject(id);
    if (!project) return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
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
    const { id } = c.req.valid("param");
    const project = await getProject(id);
    if (!project) return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    const result = await backupProject(project);
    audit("project.backup", { projectId: id, key: result.key });
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
    const { id } = c.req.valid("param");
    const project = await getProject(id);
    if (!project) return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    if (!project.storageConnectionId) {
      return c.json({ error: { code: "BAD_REQUEST", message: "Project has no storage connection" } }, 400);
    }
    const connection = await getConnection(project.storageConnectionId);
    if (!connection) return c.json({ error: { code: "NOT_FOUND", message: "Storage connection not found" } }, 404);
    await restoreProject(project, connection);
    audit("project.restore", { projectId: id });
    return c.json({ message: "Restored" });
  }
);
