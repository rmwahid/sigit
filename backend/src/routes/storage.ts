import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
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
  getObject,
  listObjects,
  putObject,
  testConnection,
} from "../modules/storage/objects";
import { decrypt, encrypt, generateSalt } from "../lib/encryption";
import { decryptSecret, encryptSecret, maskSecret } from "../lib/secret-encryption";
import { audit } from "../lib/logger";
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
  passphraseQuerySchema,
  binaryResponseSchema,
} from "./schemas/storage";
import { errorSchema, idParamSchema, idResponse, idResponseSchema } from "./schemas/common";

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
    useEncryption: conn.useEncryption,
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
    audit("storage.create_connection", { connectionId: connection.id, name: connection.name, bucket: connection.bucket });
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
    if (!connection) return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
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
    if (!connection) return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
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
    if (!deleted) return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    audit("storage.delete_connection", { connectionId: id });
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
    if (!connection) return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
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
    if (!connection) return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    const objects = await listObjects(connection, prefix);
    return c.json({ data: objects });
  }
);

storageRoutes.openapi(
  createRoute({
    method: "get",
    path: "/connections/{id}/objects/{key}",
    tags: ["Storage Objects"],
    summary: "Download an object",
    request: {
      params: keyParamSchema,
      query: passphraseQuerySchema,
    },
    responses: {
      200: {
        description: "Object content",
        content: { "application/octet-stream": { schema: binaryResponseSchema } },
      },
      400: {
        description: "Bad request",
        content: { "application/json": { schema: errorSchema } },
      },
      404: {
        description: "Not found",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { id, key } = c.req.valid("param");
    const { passphrase } = c.req.valid("query");
    const connection = await getConnection(id);
    if (!connection) return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    const body = await getObject(connection, key);
    let output = body;
    if (connection.useEncryption) {
      if (!passphrase) return c.json({ error: { code: "PASSPHRASE_REQUIRED", message: "Passphrase required for encrypted object" } }, 400);
      if (!connection.encryptionSalt) return c.json({ error: { code: "ENCRYPTION_SALT_MISSING", message: "Encryption salt missing" } }, 500);
      // Layout: IV (16 bytes) + authTag (16 bytes) + ciphertext
      const iv = body.subarray(0, 16);
      const tag = body.subarray(16, 32);
      const ciphertext = body.subarray(32);
      output = decrypt(ciphertext, passphrase, connection.encryptionSalt, iv.toString("base64"), tag.toString("base64"));
    }
    return c.body(output);
  }
);

storageRoutes.openapi(
  createRoute({
    method: "post",
    path: "/connections/{id}/objects/{key}",
    tags: ["Storage Objects"],
    summary: "Upload an object",
    request: {
      params: keyParamSchema,
      query: passphraseQuerySchema,
    },
    responses: {
      201: {
        description: "Uploaded object",
        content: { "application/json": { schema: keyResponse } },
      },
      400: {
        description: "Bad request",
        content: { "application/json": { schema: errorSchema } },
      },
      404: {
        description: "Not found",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { id, key } = c.req.valid("param");
    const { passphrase } = c.req.valid("query");
    const connection = await getConnection(id);
    if (!connection) return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    const arrayBuffer = await c.req.arrayBuffer();
    let body = Buffer.from(arrayBuffer);
    if (connection.useEncryption) {
      if (!passphrase) return c.json({ error: { code: "PASSPHRASE_REQUIRED", message: "Passphrase required for encrypted upload" } }, 400);
      const salt = connection.encryptionSalt ?? generateSalt();
      const result = encrypt(body, passphrase, Buffer.from(salt, "base64"));
      const iv = Buffer.from(result.iv, "base64");
      const tag = Buffer.from(result.tag, "base64");
      body = Buffer.concat([iv, tag, result.ciphertext]);
      if (!connection.encryptionSalt) {
        await updateConnection(id, { encryptionSalt: salt });
      }
    }
    await putObject(connection, key, body, c.req.header("Content-Type") ?? undefined);
    audit("storage.upload_object", { connectionId: id, key });
    return c.json({ data: { key } }, 201);
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
    if (!connection) return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    await deleteObject(connection, key);
    audit("storage.delete_object", { connectionId: id, key });
    return c.json({ data: { key } });
  }
);
