import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { apiReference } from "@scalar/hono-api-reference";
import { env } from "./config/env";
import { authRoutes } from "./routes/auth";
import { adminRoutes } from "./routes/admin";
import { storageRoutes } from "./routes/storage";
import { projectRoutes } from "./routes/projects";
import { requireAuth, type AuthEnv } from "./middleware/auth";
import { errorResponse, HttpError } from "./lib/http-error";
import { log } from "./lib/logger";

const app = new OpenAPIHono<AuthEnv>();

const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// Request logging middleware
app.use(async (c, next) => {
  const start = performance.now();
  await next();
  const dur = Math.round(performance.now() - start);
  const method = c.req.method;
  const path = c.req.path;
  const status = c.res.status;
  const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
  log[level]("http", `${method} ${path} -> ${status} (${dur}ms)`, {
    method,
    path,
    status,
    durationMs: dur,
  });
});

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(secureHeaders());

// Global error handler
app.onError((err, c) => {
  log.error("error", err.message, {
    path: c.req.path,
    method: c.req.method,
    stack: err.stack,
  });
  return errorResponse(c, err);
});

// Global 404 handler
app.notFound((c) => {
  log.warn("http", `404 ${c.req.method} ${c.req.path}`);
  return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
});

app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: {
    title: "SiGit API",
    version: "0.1.0",
    description: "SiGit - Storage Integration for Git. Git LFS-like + S3-compatible storage.",
  },
  servers: [{ url: "http://localhost:3000" }],
});

app.get(
  "/docs",
  apiReference({
    spec: { url: "/openapi.json" },
    pageTitle: "SiGit API Docs",
  })
);

app.get("/", (c) => c.json({ message: "SiGit API" }));

app.route("/auth", authRoutes);

// Protected routes
app.use("/storage/*", requireAuth);
app.use("/projects/*", requireAuth);
app.use("/admin/*", requireAuth);
app.route("/storage", storageRoutes);
app.route("/projects", projectRoutes);
app.route("/admin", adminRoutes);

export default {
  port: Number(env.PORT),
  fetch: app.fetch,
};
