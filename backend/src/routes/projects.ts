import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
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

const projectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  storageConnectionId: z.string().uuid(),
  lfsSizeThreshold: z.number().int().min(1).default(10 * 1024 * 1024),
  lfsPatterns: z.string().optional(),
  useEncryption: z.boolean().default(false),
});

const projectUpdateSchema = projectSchema.partial();

export const projectRoutes = new Hono()
  .get("/", async (c) => {
    const data = await listProjects();
    return c.json({ data });
  })
  .post("/", zValidator("json", projectSchema), async (c) => {
    const body = c.req.valid("json");
    const project = await createProject(body);
    return c.json({ data: project }, 201);
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const project = await getProject(id);
    if (!project) return c.json({ error: "Not found" }, 404);
    return c.json({ data: project });
  })
  .patch("/:id", zValidator("json", projectUpdateSchema), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const project = await updateProject(id, body);
    if (!project) return c.json({ error: "Not found" }, 404);
    return c.json({ data: project });
  })
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    const deleted = await deleteProject(id);
    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json({ data: { id } });
  })
  .post("/:id/push", async (c) => {
    const id = c.req.param("id");
    const passphrase = c.req.query("passphrase");
    const message = c.req.query("message") ?? "SiGit push";
    const project = await getProject(id);
    if (!project) return c.json({ error: "Not found" }, 404);

    const form = await c.req.formData();
    const files: { relativePath: string; content: Buffer; contentType?: string }[] = [];
    for (const [key, value] of form.entries()) {
      if (value instanceof File) {
        const arrayBuffer = await value.arrayBuffer();
        files.push({ relativePath: key, content: Buffer.from(arrayBuffer), contentType: value.type });
      }
    }

    if (files.length === 0) return c.json({ error: "No files" }, 400);

    const result = await pushProject(project, files, message, passphrase || undefined);
    return c.json({ data: result }, 201);
  })
  .get("/:id/history", async (c) => {
    const id = c.req.param("id");
    const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
    const history = await projectHistory(id, limit);
    return c.json({ data: history });
  })
  .get("/:id/history/:hash/diff", async (c) => {
    const id = c.req.param("id");
    const hash = c.req.param("hash");
    const project = await getProject(id);
    if (!project) return c.json({ error: "Not found" }, 404);
    const repoPath = projectRepoPath(project.id);
    const diff = await getDiff(repoPath, hash);
    const files = await getCommitFiles(repoPath, hash);
    return c.json({ data: { diff, files } });
  });
