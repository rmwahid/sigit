import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  createConnection,
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

const connectionSchema = z.object({
  name: z.string().min(1),
  endpoint: z.string().min(1),
  region: z.string().min(1),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  bucket: z.string().min(1),
  forcePathStyle: z.boolean().default(true),
  useEncryption: z.boolean().default(false),
  encryptionSalt: z.string().optional(),
});

const connectionUpdateSchema = connectionSchema.partial();

export const storageRoutes = new Hono()
  .get("/connections", async (c) => {
    const connections = await listConnections();
    return c.json({ data: connections });
  })
  .post("/connections", zValidator("json", connectionSchema), async (c) => {
    const body = c.req.valid("json");
    const data = {
      ...body,
      encryptionSalt: body.useEncryption ? body.encryptionSalt ?? generateSalt() : null,
    };
    const connection = await createConnection(data);
    return c.json({ data: connection }, 201);
  })
  .get("/connections/:id", async (c) => {
    const id = c.req.param("id");
    const connection = await getConnection(id);
    if (!connection) return c.json({ error: "Not found" }, 404);
    return c.json({ data: connection });
  })
  .patch("/connections/:id", zValidator("json", connectionUpdateSchema), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const connection = await updateConnection(id, body);
    if (!connection) return c.json({ error: "Not found" }, 404);
    return c.json({ data: connection });
  })
  .delete("/connections/:id", async (c) => {
    const id = c.req.param("id");
    const deleted = await deleteConnection(id);
    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json({ data: { id } });
  })
  .post("/connections/:id/test", async (c) => {
    const id = c.req.param("id");
    const connection = await getConnection(id);
    if (!connection) return c.json({ error: "Not found" }, 404);
    const result = await testConnection(connection);
    return c.json(result);
  })
  .get("/connections/:id/objects", async (c) => {
    const id = c.req.param("id");
    const prefix = c.req.query("prefix") ?? undefined;
    const connection = await getConnection(id);
    if (!connection) return c.json({ error: "Not found" }, 404);
    const objects = await listObjects(connection, prefix);
    return c.json({ data: objects });
  })
  .get("/connections/:id/objects/:key{.+}", async (c) => {
    const id = c.req.param("id");
    const key = c.req.param("key");
    const passphrase = c.req.query("passphrase");
    const connection = await getConnection(id);
    if (!connection) return c.json({ error: "Not found" }, 404);
    const body = await getObject(connection, key);
    let output = body;
    if (connection.useEncryption) {
      if (!passphrase) return c.json({ error: "Passphrase required for encrypted object" }, 400);
      if (!connection.encryptionSalt) return c.json({ error: "Encryption salt missing" }, 500);
      // Layout: IV (16 bytes) + authTag (16 bytes) + ciphertext
      const iv = body.subarray(0, 16);
      const tag = body.subarray(16, 32);
      const ciphertext = body.subarray(32);
      output = decrypt(ciphertext, passphrase, connection.encryptionSalt, iv.toString("base64"), tag.toString("base64"));
    }
    return c.body(output);
  })
  .post("/connections/:id/objects/:key{.+}", async (c) => {
    const id = c.req.param("id");
    const key = c.req.param("key");
    const passphrase = c.req.query("passphrase");
    const connection = await getConnection(id);
    if (!connection) return c.json({ error: "Not found" }, 404);
    const arrayBuffer = await c.req.arrayBuffer();
    let body = Buffer.from(arrayBuffer);
    if (connection.useEncryption) {
      if (!passphrase) return c.json({ error: "Passphrase required for encrypted upload" }, 400);
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
    return c.json({ data: { key } }, 201);
  })
  .delete("/connections/:id/objects/:key{.+}", async (c) => {
    const id = c.req.param("id");
    const key = c.req.param("key");
    const connection = await getConnection(id);
    if (!connection) return c.json({ error: "Not found" }, 404);
    await deleteObject(connection, key);
    return c.json({ data: { key } });
  });
