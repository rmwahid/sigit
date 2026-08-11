import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { createToken, listTokens, revokeToken } from "../modules/auth/tokens";
import { authed, type AuthEnv } from "../middleware/auth";
import { audit } from "../lib/logger";
import { idParamSchema } from "./schemas/common";

const tokenSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    lastUsedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi("Token");

const tokenListResponse = z.object({ data: z.array(tokenSchema) });
const tokenCreateInput = z.object({ name: z.string().min(1).max(100) });
const tokenCreatedResponse = z.object({ data: z.object({ id: z.string().uuid(), token: z.string(), name: z.string() }) });
const messageResponse = z.object({ message: z.string() });

export const tokenRoutes = new OpenAPIHono<AuthEnv>();

tokenRoutes.openapi(
  createRoute({
    method: "get",
    path: "/",
    tags: ["Tokens"],
    summary: "List git tokens",
    responses: {
      200: {
        description: "List of tokens",
        content: { "application/json": { schema: tokenListResponse } },
      },
    },
  }),
  authed(async (c) => {
    const user = c.get("user");
    const items = await listTokens(user.id);
    return c.json({
      data: items.map((t) => ({
        id: t.id,
        name: t.name,
        lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
        createdAt: t.createdAt.toISOString(),
      })),
    });
  })
);

tokenRoutes.openapi(
  createRoute({
    method: "post",
    path: "/",
    tags: ["Tokens"],
    summary: "Create a git token (shown only once)",
    request: {
      body: { content: { "application/json": { schema: tokenCreateInput } } },
    },
    responses: {
      201: {
        description: "Created token with raw value",
        content: { "application/json": { schema: tokenCreatedResponse } },
      },
    },
  }),
  authed(async (c) => {
    const user = c.get("user");
    const { name } = c.req.valid("json");
    const { token, id } = await createToken(user.id, name);
    audit("token.create", { tokenId: id, name });
    return c.json({ data: { id, token, name } }, 201);
  })
);

tokenRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/{id}",
    tags: ["Tokens"],
    summary: "Revoke a git token",
    request: { params: idParamSchema },
    responses: {
      200: {
        description: "Revoked",
        content: { "application/json": { schema: messageResponse } },
      },
      404: {
        description: "Not found",
        content: { "application/json": { schema: z.object({ error: z.string() }).openapi("Error") } },
      },
    },
  }),
  authed(async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const revoked = await revokeToken(id, user.id);
    if (!revoked) return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    audit("token.revoke", { tokenId: id });
    return c.json({ message: "Revoked" });
  })
);
