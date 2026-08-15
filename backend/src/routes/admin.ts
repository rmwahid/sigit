import { DEFAULT_LOG_LIMIT } from "@/constants/limits";
import { ERROR_CODES } from "@/constants/errors";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import { requireAdmin } from "@/middleware/auth";
import { getRingBuffer, log, readAuditLog, subscribe } from "@/lib/logger";
import type { AuthEnv } from "@/middleware/auth";

const logEntrySchema = z
  .object({
    ts: z.string(),
    scope: z.string(),
    message: z.string(),
    level: z.string().optional(),
    event: z.string().optional(),
  })
  .passthrough()
  .openapi("LogEntry");

const logsResponse = z.object({ data: z.array(logEntrySchema) }).openapi("LogsResponse");
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) }).openapi("Error");

export const adminRoutes = new OpenAPIHono<AuthEnv>();

adminRoutes.openapi(
  createRoute({
    method: "get",
    path: "/logs",
    tags: ["Admin"],
    summary: "Get recent logs (audit + recent request log)",
    request: {
      query: z.object({
        limit: z.string().optional(),
        before: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: "Recent logs",
        content: { "application/json": { schema: logsResponse } },
      },
      401: {
        description: "Unauthorized",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "Admin only" } }, 403) as never;
    const { limit, before } = c.req.valid("query");
    const l = limit ? Number(limit) : DEFAULT_LOG_LIMIT;
    const auditLogs = readAuditLog(l, before);
    const ringLogs = getRingBuffer(l).reverse();
    // Combine: audit (persisted) + recent ring (live). Dedup by ts+message+scope.
    const seen = new Set<string>();
    const merged: Record<string, unknown>[] = [];
    for (const e of [...auditLogs, ...ringLogs]) {
      const key = `${e.ts}|${e.scope ?? e.event}|${e.message ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(e);
    }
    return c.json({ data: merged });
  }
);

// Server-Sent Events stream of live request logs
adminRoutes.openapi(
  createRoute({
    method: "get",
    path: "/logs/stream",
    tags: ["Admin"],
    summary: "Stream live logs (SSE)",
    responses: {
      200: {
        description: "Live log stream (SSE)",
        content: { "text/event-stream": { schema: z.any() } },
      },
    },
  }),
  async (c) => {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ error: { code: ERROR_CODES.FORBIDDEN, message: "Admin only" } }, 403) as never;
    log.info("admin", "log stream started");
    return streamSSE(c, async (stream) => {
      const unsubscribe = subscribe((entry) => {
        stream.writeSSE({ data: JSON.stringify(entry) });
      });
      c.req.raw.signal.addEventListener("abort", () => unsubscribe());
      // Keep the stream open
      await stream.onAbort(() => unsubscribe());
      // Block until aborted (prevent handler from returning immediately)
      await new Promise<void>((resolve) => {
        c.req.raw.signal.addEventListener("abort", () => resolve());
      });
    });
  }
);
