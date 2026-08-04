import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  projectHistory,
  pushProject,
  updateProject,
  projectRepoPath,
} from "../modules/projects/projects";
import { getDiff, getCommitFiles } from "../modules/projects/git";
import { validateUploadFiles, validateRepoPath } from "../lib/upload-validation";
import { audit } from "../lib/logger";

const projectSchema = z
  .object({
    id: z.string().uuid().openapi({ example: "a3f0c1a2-0000-4000-8000-000000000001" }),
    name: z.string().min(1).openapi({ example: "My Project" }),
    description: z.string().optional(),
    repoPath: z.string().min(1).openapi({ example: "C:/sigit/projects/my-project" }),
    storageConnectionId: z.string().uuid(),
    lfsSizeThreshold: z.number().int().min(1).default(10 * 1024 * 1024),
    lfsPatterns: z.string().nullable().optional(),
    useEncryption: z.boolean().default(false),
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
  })
  .openapi("Project");

const projectInputSchema = z.object({
  name: z.string().min(1).openapi({ example: "My Project" }),
  description: z.string().optional(),
  repoPath: z.string().min(1).openapi({ example: "C:/sigit/projects/my-project" }),
  storageConnectionId: z.string().uuid(),
  lfsSizeThreshold: z.number().int().min(1).default(10 * 1024 * 1024),
  lfsPatterns: z.string().optional(),
  useEncryption: z.boolean().default(false),
});

const projectUpdateSchema = projectInputSchema.partial();
const idParamSchema = z.object({ id: z.string().uuid() });
const errorSchema = z.object({ error: z.string() }).openapi("Error");

const projectListResponse = z.object({ data: z.array(projectSchema) });
const projectResponse = z.object({ data: projectSchema });
const idResponse = z.object({ data: z.object({ id: z.string() }) });

const pushResponse = z
  .object({
    data: z.object({
      commitHash: z.string(),
      files: z.array(
        z.object({
          path: z.string(),
          lfs: z.boolean(),
          oid: z.string().optional(),
        })
      ),
    }),
  })
  .openapi("PushResult");

const historyResponse = z
  .object({
    data: z.object({
      head: z.string().nullable(),
      commits: z.array(
        z.object({
          hash: z.string(),
          date: z.string(),
          message: z.string(),
          author: z.string(),
        })
      ),
    }),
  })
  .openapi("History");

const diffResponse = z
  .object({
    data: z.object({
      diff: z.string(),
      files: z.array(z.object({ path: z.string(), status: z.string() })),
    }),
  })
  .openapi("Diff");

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
    if (body.repoPath) {
      const pathError = validateRepoPath(body.repoPath);
      if (pathError) return c.json({ error: { code: "INVALID_REPO_PATH", message: pathError } }, 400);
    }
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
    const deleted = await deleteProject(id);
    if (!deleted) return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    return c.json({ data: { id } });
  }
);

projectRoutes.openapi(
  createRoute({
    method: "post",
    path: "/{id}/push",
    tags: ["Projects"],
    summary: "Push files to a project (Git + S3 LFS)",
    request: {
      params: idParamSchema,
      query: z.object({
        message: z.string().optional(),
        passphrase: z.string().optional(),
      }),
    },
    responses: {
      201: {
        description: "Pushed files",
        content: { "application/json": { schema: pushResponse } },
      },
      400: {
        description: "No files or bad request",
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
    const { passphrase, message } = c.req.valid("query");
    const project = await getProject(id);
    if (!project) return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);

    const form = await c.req.formData();
    const files: { relativePath: string; content: Buffer; contentType?: string }[] = [];
    for (const [key, value] of form.entries()) {
      if (value instanceof File) {
        const arrayBuffer = await value.arrayBuffer();
        files.push({ relativePath: key, content: Buffer.from(arrayBuffer), contentType: value.type });
      }
    }

    const validationError = validateUploadFiles(
      files.map((f) => ({ relativePath: f.relativePath, size: f.content.length }))
    );
    if (validationError) return c.json({ error: { code: "INVALID_UPLOAD", message: validationError } }, 400);

    const result = await pushProject(project, files, message || "SiGit push", passphrase || undefined);
    audit("project.push", { projectId: id, commitHash: result.commitHash, files: result.files.length });
    return c.json({ data: result }, 201);
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
      query: z.object({ limit: z.string().optional() }),
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
      params: z.object({ id: z.string().uuid(), hash: z.string() }),
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
    const repoPath = projectRepoPath(project);
    const diff = await getDiff(repoPath, hash);
    const files = await getCommitFiles(repoPath, hash);
    return c.json({ data: { diff, files } });
  }
);
