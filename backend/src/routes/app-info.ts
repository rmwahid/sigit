import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { env } from "../config/env";

export const appInfoRoutes = new OpenAPIHono();

const appInfoResponse = z.object({
  data: z.object({
    gitBaseUrl: z.string(),
  }),
});

// Public endpoint: dipakai frontend untuk membangun snippet setup git per project.
appInfoRoutes.openapi(
  createRoute({
    method: "get",
    path: "/",
    tags: ["App"],
    summary: "Public app info, git base url for setup snippets",
    responses: {
      200: {
        description: "App info",
        content: { "application/json": { schema: appInfoResponse } },
      },
    },
  }),
  async (c) => {
    return c.json({ data: { gitBaseUrl: env.GIT_BASE_URL } });
  }
);
