import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { createToken, listTokens, revokeToken } from "../modules/auth/tokens";
import { authed, type AuthEnv } from "../middleware/auth";
import { audit } from "../lib/logger";
import { idParamSchema } from "./schemas/common";

const tokenSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    scopes: z.array(z.enum(["read", "write"])),
    expiresAt: z.string().datetime(),
    lastUsedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi("Token");

const tokenListResponse = z.object({ data: z.array(tokenSchema) });
const tokenCreateInput = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(["read", "write"])).default(["read"]),
  // Flexible (bebas 1-30 hari), cap maksimal 30 hari demi keamanan token.
  expiresInDays: z.coerce.number().int().min(1).max(30),
});
const tokenCreatedResponse = z.object({
  data: z.object({
    id: z.string().uuid(),
    token: z.string(),
    name: z.string(),
    scopes: z.array(z.enum(["read", "write"])),
    expiresAt: z.string().datetime(),
  }),
});
const messageResponse = z.object({ message: z.string() });
const errorSchema = z.object({ error: z.string() }).openapi("Error");

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
        scopes: t.scopes,
        expiresAt: t.expiresAt.toISOString(),
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
    const { name, scopes, expiresInDays } = c.req.valid("json");
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    const { token, id } = await createToken(user.id, name, scopes, expiresAt);
    audit("token.create", { tokenId: id, name, scopes, expiresInDays });
    return c.json({ data: { id, token, name, scopes, expiresAt: expiresAt.toISOString() } }, 201);
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
        content: { "application/json": { schema: errorSchema } },
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
