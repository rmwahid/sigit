import { MIN_PASSWORD_LENGTH } from "../constants/limits";
import { AUDIT_EVENTS } from "../constants/audit-events";
import { ERROR_CODES } from "../constants/errors";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { deleteUser, listUsers, setUserPassword } from "../modules/auth/auth";
import { ROLE_SLUGS } from "../constants/roles";
import { requireAdmin, type AuthEnv } from "../middleware/auth";
import { audit } from "../lib/logger";
import { idParamSchema } from "./schemas/common";

const userSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
    role: z.enum(ROLE_SLUGS),
    createdAt: z.string().datetime(),
  })
  .openapi("User");

const userListResponse = z.object({ data: z.array(userSchema) });
const resetPasswordInput = z.object({ password: z.string().min(MIN_PASSWORD_LENGTH) });
const messageResponse = z.object({ message: z.string() });
const errorSchema = z.object({ error: z.string() }).openapi("Error");

export const userRoutes = new OpenAPIHono<AuthEnv>();

userRoutes.openapi(
  createRoute({
    method: "get",
    path: "/",
    tags: ["Users"],
    summary: "List users (admin only)",
    responses: {
      200: {
        description: "List of users",
        content: { "application/json": { schema: userListResponse } },
      },
    },
  }),
  async (c) => {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "Admin only" } }, 403) as never;
    const items = await listUsers();
    return c.json({
      data: items.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })),
    });
  }
);

userRoutes.openapi(
  createRoute({
    method: "post",
    path: "/{id}/reset-password",
    tags: ["Users"],
    summary: "Reset a user password (admin only)",
    request: {
      params: idParamSchema,
      body: { content: { "application/json": { schema: resetPasswordInput } } },
    },
    responses: {
      200: {
        description: "Password reset",
        content: { "application/json": { schema: messageResponse } },
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
    const { password } = c.req.valid("json");
    const rows = await listUsers();
    if (!rows.some((u) => u.id === id)) {
      return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Not found" } }, 404) as never;
    }
    await setUserPassword(id, password);
    audit(AUDIT_EVENTS.USER_RESET_PASSWORD, { userId: id, by: admin.email });
    return c.json({ message: "Password reset" });
  }
);

userRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/{id}",
    tags: ["Users"],
    summary: "Delete a user (admin only, not yourself)",
    request: { params: idParamSchema },
    responses: {
      200: {
        description: "Deleted",
        content: { "application/json": { schema: messageResponse } },
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
    if (id === admin.id) {
      return c.json({ error: { code: ERROR_CODES.BAD_REQUEST, message: "Cannot delete yourself" } }, 400) as never;
    }
    const deleted = await deleteUser(id);
    if (!deleted) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Not found" } }, 404) as never;
    audit(AUDIT_EVENTS.USER_DELETE, { userId: id, by: admin.email });
    return c.json({ message: "Deleted" });
  }
);
