import { AUDIT_EVENTS } from "@/constants/audit-events";
import { ERROR_CODES } from "@/constants/errors";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getProject } from "@/modules/projects/projects";
import { getProjectAccess, tokenScopeForUser } from "@/modules/auth/access";
import { requireUser, type AuthEnv } from "@/middleware/auth";
import { audit } from "@/lib/logger";
import { idParamSchema } from "./schemas/common";
import {
  createToken,
  listTokensWithProjectScopes,
  revokeToken,
  setTokenProjectScopes,
  TOKEN_MAX_EXPIRY_DAYS,
} from "@/modules/auth/tokens";
import { TOKEN_SCOPE_SLUGS, type TokenScope } from "@/constants/scopes";

export const tokenProjectSchema = z.object({
  projectId: z.string().uuid(),
  scope: z.enum(TOKEN_SCOPE_SLUGS),
});

const tokenSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    projects: z.array(tokenProjectSchema),
    expiresAt: z.string().datetime(),
    lastUsedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi("Token");

const tokenListResponse = z.object({ data: z.array(tokenSchema) });
const tokenCreateInput = z.object({
  name: z.string().min(1).max(100),
  // Per-project access: the token only works for the selected projects ("write" includes "read").
  projects: z.array(tokenProjectSchema).min(1),
  // Flexible (1-30 days), capped at 30 days for token security.
  expiresInDays: z.coerce.number().int().min(1).max(TOKEN_MAX_EXPIRY_DAYS),
});
const tokenCreatedResponse = z.object({
  data: z.object({
    id: z.string().uuid(),
    token: z.string(),
    name: z.string(),
    projects: z.array(tokenProjectSchema),
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
  async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: { code: ERROR_CODES.UNAUTHORIZED, message: "Unauthorized" } }, 401) as never;
    const items = await listTokensWithProjectScopes(user.id);
    return c.json({
      data: items.map(({ token, projects }) => ({
        id: token.id,
        name: token.name,
        projects,
        expiresAt: token.expiresAt.toISOString(),
        lastUsedAt: token.lastUsedAt ? token.lastUsedAt.toISOString() : null,
        createdAt: token.createdAt.toISOString(),
      })),
    });
  }
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
  async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: { code: ERROR_CODES.UNAUTHORIZED, message: "Unauthorized" } }, 401) as never;
    // Explicit structural annotation: c.req.valid() from zod-openapi 1.5.2 + zod v4
    // resolves to any for nested schemas (z.infer/z.output too); this annotation
    // keeps type safety without changing runtime (zod still validates).
    const body: {
      name: string;
      projects: { projectId: string; scope: TokenScope }[];
      expiresInDays: number;
    } = c.req.valid("json");
    const { name, projects, expiresInDays } = body;
    const projectIds = projects.map((p) => p.projectId);
    if (new Set(projectIds).size !== projectIds.length) {
      return c.json({ error: { code: ERROR_CODES.BAD_REQUEST, message: "projects must not contain duplicates" } }, 400) as never;
    }
    const found = await Promise.all(projects.map((p) => getProject(p.projectId)));
    if (found.some((p) => !p)) {
      return c.json({ error: { code: ERROR_CODES.BAD_REQUEST, message: "One or more projects do not exist" } }, 400) as never;
    }
    // Token permissions are DERIVED: they can never exceed the owner's access
    // (read needs clone, write needs push; admin bypasses).
    for (const p of projects) {
      const access = await getProjectAccess(user.id, p.projectId);
      if (!tokenScopeForUser(access, p.scope)) {
        return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "No access to this project" } }, 403) as never;
      }
    }
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    const { token, id } = await createToken(user.id, name, expiresAt);
    await setTokenProjectScopes(id, projects);
    audit(AUDIT_EVENTS.TOKEN_CREATE, {
      tokenId: id,
      name,
      projects: projects.map((p) => p.projectId),
      expiresInDays,
    });
    return c.json({ data: { id, token, name, projects, expiresAt: expiresAt.toISOString() } }, 201);
  }
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
  async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: { code: ERROR_CODES.UNAUTHORIZED, message: "Unauthorized" } }, 401) as never;
    const { id } = c.req.valid("param");
    const revoked = await revokeToken(id, user.id);
    if (!revoked) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Not found" } }, 404) as never;
    audit(AUDIT_EVENTS.TOKEN_REVOKE, { tokenId: id });
    return c.json({ message: "Revoked" });
  }
);
