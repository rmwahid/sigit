import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { getUserActivity } from "@/modules/activity/activity";
import { listAccessibleProjectIds, listPublicProjects } from "@/modules/auth/access";
import { getUserByEmail } from "@/modules/auth/auth";

// Public routes (no auth): explore public projects + user profiles.
// Mounted OUTSIDE the requireAuth block in index.ts.
export const exploreRoutes = new OpenAPIHono();

const publicProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isPublic: z.boolean(),
});

exploreRoutes.openapi(
  createRoute({
    method: "get",
    path: "/projects",
    tags: ["Explore"],
    summary: "List public projects (no auth)",
    responses: {
      200: {
        description: "Public projects",
        content: {
          "application/json": {
            schema: z.object({ data: z.array(publicProjectSchema) }),
          },
        },
      },
    },
  }),
  async (c) => {
    const projects = await listPublicProjects();
    return c.json({
      data: projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        isPublic: p.isPublic,
      })),
    });
  }
);

exploreRoutes.openapi(
  createRoute({
    method: "get",
    path: "/users/:email",
    tags: ["Explore"],
    summary: "Public user profile (no auth)",
    request: { params: z.object({ email: z.string() }) },
    responses: {
      200: {
        description: "User profile with public projects",
        content: {
          "application/json": {
            schema: z.object({
              data: z.object({
                email: z.string(),
                role: z.string(),
                projects: z.array(publicProjectSchema),
              }),
            }),
          },
        },
      },
      404: {
        description: "Not found",
        content: {
          "application/json": {
            schema: z.object({ error: z.object({ code: z.string(), message: z.string() }) }),
          },
        },
      },
    },
  }),
  async (c) => {
    const { email } = c.req.valid("param");
    const user = await getUserByEmail(email);
    if (!user) {
      return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    }
    const projects = await listPublicProjects();
    const accessible = await listAccessibleProjectIds(user.id);
    return c.json({
      data: {
        email: user.email,
        role: user.role,
        projects: projects
          .filter((p) => accessible.includes(p.id))
          .map((p) => ({ id: p.id, name: p.name, description: p.description, isPublic: p.isPublic })),
      },
    });
  }
);

exploreRoutes.openapi(
  createRoute({
    method: "get",
    path: "/users/:email/activity",
    tags: ["Explore"],
    summary: "Per-day commit counts for a user across public projects (no auth)",
    request: { params: z.object({ email: z.string() }) },
    responses: {
      200: {
        description: "Daily commit activity",
        content: {
          "application/json": {
            schema: z.object({
              data: z.object({ days: z.array(z.object({ date: z.string(), count: z.number().int().nonnegative() })) }),
            }),
          },
        },
      },
      404: {
        description: "Not found",
        content: {
          "application/json": {
            schema: z.object({ error: z.object({ code: z.string(), message: z.string() }) }),
          },
        },
      },
    },
  }),
  async (c) => {
    const { email } = c.req.valid("param");
    const user = await getUserByEmail(email);
    if (!user) {
      return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    }
    const days = await getUserActivity(email);
    return c.json({ data: { days } });
  }
);
