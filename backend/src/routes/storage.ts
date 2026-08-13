import { AUDIT_EVENTS } from "../constants/audit-events";
import { ERROR_CODES } from "../constants/errors";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { decryptSecret, encryptSecret, maskSecret } from "../lib/secret-encryption";
import { audit } from "../lib/logger";
import { errorSchema, idParamSchema, idResponse, idResponseSchema } from "./schemas/common";
import {
  createConnection,
  createConnectionFromInput,
  deleteConnection,
  getConnection,
  listConnections,
  updateConnection,
} from "../modules/storage/connections";
import {
  deleteObject,
  listObjects,
  testConnection,
} from "../modules/storage/objects";
import type { StorageConnection } from "../db/schema/storage";
import {
  connectionSchema,
  connectionInputSchema,
  connectionUpdateSchema,
  keyParamSchema,
  objectSummarySchema,
  connectionListResponse,
  connectionResponse,
  testResponse,
  objectListResponse,
  keyResponse,
  prefixQuerySchema,
} from "./schemas/storage";

function toConnectionResponse(conn: StorageConnection) {
  const secret = decryptSecret({ keyId: conn.encryptionKeyId, ciphertext: conn.secretEncrypted });
  return {
    id: conn.id,
    name: conn.name,
    provider: conn.provider,
    endpoint: conn.endpoint,
    region: conn.region,
    accessKeyId: conn.accessKeyId,
    secretMasked: maskSecret(secret),
    hasSecret: true,
    bucket: conn.bucket,
    forcePathStyle: conn.forcePathStyle,
    metadata: conn.metadata,
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
  };
}

export const storageRoutes = new OpenAPIHono();

storageRoutes.openapi(
  createRoute({
    method: "get",
    path: "/connections",
    tags: ["Storage Connections"],
    summary: "List storage connections",
    responses: {
      200: {
        description: "List of storage connections",
        content: { "application/json": { schema: connectionListResponse } },
      },
    },
  }),
  async (c) => {
    const connections = await listConnections();
    return c.json({ data: connections.map(toConnectionResponse) });
  }
);

storageRoutes.openapi(
  createRoute({
    method: "post",
    path: "/connections",
    tags: ["Storage Connections"],
    summary: "Create a storage connection",
    request: {
      body: { content: { "application/json": { schema: connectionInputSchema } } },
    },
    responses: {
      201: {
        description: "Created storage connection",
        content: { "application/json": { schema: connectionResponse } },
      },
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const connection = await createConnectionFromInput(body);
    audit(AUDIT_EVENTS.STORAGE_CREATE_CONNECTION, { connectionId: connection.id, name: connection.name, bucket: connection.bucket });
    return c.json({ data: toConnectionResponse(connection) }, 201);
  }
);

storageRoutes.openapi(
  createRoute({
    method: "get",
    path: "/connections/{id}",
    tags: ["Storage Connections"],
    summary: "Get a storage connection",
    request: { params: idParamSchema },
    responses: {
      200: {
        description: "Storage connection detail",
        content: { "application/json": { schema: connectionResponse } },
      },
      404: {
        description: "Not found",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const connection = await getConnection(id);
    if (!connection) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Not found" } }, 404);
    return c.json({ data: toConnectionResponse(connection) });
  }
);

storageRoutes.openapi(
  createRoute({
    method: "patch",
    path: "/connections/{id}",
    tags: ["Storage Connections"],
    summary: "Update a storage connection",
    request: {
      params: idParamSchema,
      body: { content: { "application/json": { schema: connectionUpdateSchema } } },
    },
    responses: {
      200: {
        description: "Updated storage connection",
        content: { "application/json": { schema: connectionResponse } },
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
    const updateData: Record<string, unknown> = { ...body };
    delete updateData.secretAccessKey;
    if (body.secretAccessKey) {
      const encrypted = encryptSecret(body.secretAccessKey);
      updateData.secretEncrypted = encrypted.ciphertext;
      updateData.encryptionKeyId = encrypted.keyId;
    }
    const connection = await updateConnection(id, updateData);
    if (!connection) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Not found" } }, 404);
    return c.json({ data: toConnectionResponse(connection) });
  }
);

storageRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/connections/{id}",
    tags: ["Storage Connections"],
    summary: "Delete a storage connection",
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
    const deleted = await deleteConnection(id);
    if (!deleted) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Not found" } }, 404);
    audit(AUDIT_EVENTS.STORAGE_DELETE_CONNECTION, { connectionId: id });
    return c.json({ data: { id } });
  }
);

storageRoutes.openapi(
  createRoute({
    method: "post",
    path: "/connections/{id}/test",
    tags: ["Storage Connections"],
    summary: "Test a storage connection",
    request: { params: idParamSchema },
    responses: {
      200: {
        description: "Connection test result",
        content: { "application/json": { schema: testResponse } },
      },
      404: {
        description: "Not found",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const connection = await getConnection(id);
    if (!connection) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Not found" } }, 404);
    const result = await testConnection(connection);
    return c.json(result);
  }
);

storageRoutes.openapi(
  createRoute({
    method: "get",
    path: "/connections/{id}/objects",
    tags: ["Storage Objects"],
    summary: "List objects in a bucket",
    request: {
      params: idParamSchema,
      query: prefixQuerySchema,
    },
    responses: {
      200: {
        description: "List of objects",
        content: { "application/json": { schema: objectListResponse } },
      },
      404: {
        description: "Not found",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const { prefix } = c.req.valid("query");
    const connection = await getConnection(id);
    if (!connection) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Not found" } }, 404);
    const objects = await listObjects(connection, prefix);
    return c.json({ data: objects });
  }
);

storageRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/connections/{id}/objects/{key}",
    tags: ["Storage Objects"],
    summary: "Delete an object",
    request: { params: keyParamSchema },
    responses: {
      200: {
        description: "Deleted",
        content: { "application/json": { schema: keyResponse } },
      },
      404: {
        description: "Not found",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { id, key } = c.req.valid("param");
    const connection = await getConnection(id);
    if (!connection) return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Not found" } }, 404);
    await deleteObject(connection, key);
    audit(AUDIT_EVENTS.STORAGE_DELETE_OBJECT, { connectionId: id, key });
    return c.json({ data: { key } });
  }
);
