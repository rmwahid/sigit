import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.string().default("3000"),
  GIT_BASE_URL: z.string().default("http://localhost:3000"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  SESSION_TTL_DAYS: z.string().default("7"),
  NODE_ENV: z.string().default("development"),
  LOG_DIR: z.string().default("./data/logs"),
  LOG_RING_SIZE: z.string().default("500"),
  LOG_AUDIT_MAX_BYTES: z.string().default((5 * 1024 * 1024).toString()), // 5 MB
  LOG_AUDIT_MAX_FILES: z.string().default("5"),
  SIGIT_PROJECTS_ROOT: z.string().default("./data/projects"),
  ENCRYPTION_KEYS: z
    .string()
    .transform((s) => {
      const parsed = JSON.parse(s) as Record<string, string>;
      if (typeof parsed !== "object" || parsed === null) throw new Error("ENCRYPTION_KEYS must be a JSON object");
      return parsed;
    })
    .refine((keys) => Object.keys(keys).length > 0, { message: "ENCRYPTION_KEYS must not be empty" }),
});

export const env = envSchema.parse(process.env);
