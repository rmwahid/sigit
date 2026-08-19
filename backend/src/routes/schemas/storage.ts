import { z } from "@hono/zod-openapi";

export const connectionSchema = z
  .object({
    id: z.string().uuid().openapi({ example: "d096dd70-97bb-439e-b04b-646d958185dc" }),
    name: z.string().min(1).openapi({ example: "Hetzner" }),
    provider: z.string().default("s3"),
    endpoint: z.string().min(1).openapi({ example: "https://fsn1.your-objectstorage.com" }),
    region: z.string().min(1).openapi({ example: "eu-central" }),
    accessKeyId: z.string().min(1),
    secretMasked: z.string().openapi({ example: "abcd***wxyz" }),
    hasSecret: z.boolean(),
    bucket: z.string().min(1).openapi({ example: "sigit" }),
    forcePathStyle: z.boolean().default(true),
    metadata: z.any().optional(),
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
  })
  .openapi("StorageConnection");

export const connectionInputSchema = z.object({
  name: z.string().min(1).openapi({ example: "Hetzner" }),
  endpoint: z.string().min(1).openapi({ example: "https://fsn1.your-objectstorage.com" }),
  region: z.string().min(1).openapi({ example: "eu-central" }),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  bucket: z.string().min(1).openapi({ example: "sigit" }),
  forcePathStyle: z.boolean().default(true),
});

export const connectionUpdateSchema = connectionInputSchema.partial();

export const keyParamSchema = z.object({
  id: z.string().uuid(),
  key: z.string().openapi({ example: "path/to/object" }),
});

export const objectSummarySchema = z
  .object({
    key: z.string().optional(),
    size: z.number().int().optional(),
    lastModified: z.string().datetime().nullable().optional(),
  })
  .openapi("ObjectSummary");

export const connectionListResponse = z.object({ data: z.array(connectionSchema) });
export const connectionResponse = z.object({ data: connectionSchema });
export const testResponse = z.object({ ok: z.boolean(), error: z.string().optional() });
export const objectListResponse = z.object({ data: z.array(objectSummarySchema) });
export const keyResponse = z.object({ data: z.object({ key: z.string() }) });

export const prefixQuerySchema = z.object({ prefix: z.string().optional() });
