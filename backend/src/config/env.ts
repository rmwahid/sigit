import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  S3_ENDPOINT: z.string().min(1),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  PORT: z.string().default("3000"),
});

export const env = envSchema.parse(process.env);
