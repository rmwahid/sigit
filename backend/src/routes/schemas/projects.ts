import { z } from "@hono/zod-openapi";
import { errorSchema, idParamSchema, idResponse, messageSchema } from "./common";
import { DEFAULT_LFS_SIZE_THRESHOLD } from "@/db/schema/projects";

// Project name = safe slug for the git URL (/projects/<name>.git):
// huruf kecil, angka, -, _; mulai & diakhiri alfanumerik; panjang 2-64.
export const projectNameSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*[A-Za-z0-9]$/, "Use letters, numbers, dashes, or underscores (no spaces, e.g. my-project or NotesApp)")

export const projectSchema = z
  .object({
    id: z.string().uuid().openapi({ example: "a3f0c1a2-0000-4000-8000-000000000001" }),
    name: projectNameSchema.openapi({ example: "notes-app" }),
    description: z.string().optional(),
    storageConnectionId: z.string().uuid().nullable(),
    lfsSizeThreshold: z.number().int().min(1).default(DEFAULT_LFS_SIZE_THRESHOLD),
    lfsPatterns: z.string().nullable().optional(),
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
  })
  .openapi("Project");

export const projectInputSchema = z.object({
  name: projectNameSchema.openapi({ example: "notes-app" }),
  description: z.string().optional(),
  storageConnectionId: z.string().uuid().openapi({ example: "d096dd70-97bb-439e-b04b-646d958185dc" }),
  lfsSizeThreshold: z.number().int().min(1).default(DEFAULT_LFS_SIZE_THRESHOLD),
  lfsPatterns: z.string().optional(),
});

export const projectUpdateSchema = z.object({
  name: projectNameSchema.optional(),
  description: z.string().optional(),
  storageConnectionId: z.string().uuid().nullable().optional(),
  lfsSizeThreshold: z.number().int().min(1).optional(),
  lfsPatterns: z.string().optional(),
  isPublic: z.boolean().optional(),
});

export const projectWithConnectionSchema = z.object({
  name: projectNameSchema.openapi({ example: "notes-app" }),
  description: z.string().optional(),
  connection: z.object({
    name: z.string().min(1).openapi({ example: "Hetzner" }),
    endpoint: z.string().min(1).openapi({ example: "https://fsn1.your-objectstorage.com" }),
    region: z.string().min(1).openapi({ example: "eu-central" }),
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
    bucket: z.string().min(1).openapi({ example: "sigit" }),
    forcePathStyle: z.boolean().optional(),
  }),
});

export const projectListResponse = z.object({ data: z.array(projectSchema) });
export const projectResponse = z.object({ data: projectSchema });

export const historyResponse = z
  .object({
    data: z.object({
      head: z.string().nullable(),
      commits: z.array(
        z.object({
          hash: z.string(),
          date: z.string(),
          message: z.string(),
          author: z.string(),
        })
      ),
    }),
  })
  .openapi("History");

export const diffResponse = z
  .object({
    data: z.object({
      diff: z.string(),
      files: z.array(z.object({ path: z.string(), status: z.string() })),
    }),
  })
  .openapi("Diff");

export const backupResponse = z
  .object({ data: z.object({ key: z.string(), size: z.number() }) })
  .openapi("BackupResult");

export const historyQuerySchema = z.object({ limit: z.string().optional(), offset: z.string().optional() });

export const diffParamSchema = z.object({ id: z.string().uuid(), hash: z.string() });
