import { ERROR_CODES } from "./constants/errors";
import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { apiReference } from "@scalar/hono-api-reference";
import { env } from "./config/env";
import { appInfoRoutes } from "./routes/app-info";
import { exploreRoutes } from "./routes/explore";
import { authRoutes } from "./routes/auth";
import { adminRoutes } from "./routes/admin";
import { userRoutes } from "./routes/users";
import { invitationRoutes } from "./routes/invitations";
import { emailSettingsRoutes } from "./routes/email-settings";
import { storageRoutes } from "./routes/storage";
import { projectRoutes } from "./routes/projects";
import { branchRoutes } from "./routes/branches";
import { branchProtectionRoutes } from "./routes/branch-protection";
import { pullRequestRoutes } from "./routes/pull-requests";
import { browserRoutes } from "./routes/browser";
import { gitRoutes } from "./routes/git";
import { lfsRoutes } from "./routes/lfs";
import { tokenRoutes } from "./routes/tokens";
import { requireAuth, type AuthEnv } from "./middleware/auth";
import { errorResponse } from "./lib/http-error";
import { log } from "./lib/logger";

const app = new OpenAPIHono<AuthEnv>();

const allowedOrigins = env.CORS_ORIGINS.split(",")
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
  return c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: "Not found" } }, 404);
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

// Public app info (git base url for setup snippets), before the requireAuth block
app.route("/app-info", appInfoRoutes);
app.route("/explore", exploreRoutes);

app.route("/auth", authRoutes);

// Git smart HTTP + LFS + file browser - MUST be mounted before
// app.use("/projects/*", requireAuth): git/git-lfs clients do not send a
// session cookie, only a Basic auth token, and the browser routes decide
// access per request (session `view` permission OR public anonymous).
// LFS first, then git: the .git catch-all in gitRoutes would hijack /info/lfs/*.
app.route("/projects", lfsRoutes);
app.route("/projects", browserRoutes);
app.route("/projects", gitRoutes);

// Protected routes
app.use("/storage/*", requireAuth);
app.use("/projects/*", requireAuth);
app.use("/admin/*", requireAuth);
app.use("/tokens/*", requireAuth);
app.route("/storage", storageRoutes);
app.route("/projects", projectRoutes);
app.route("/projects", branchRoutes);
app.route("/projects", pullRequestRoutes);
app.route("/projects", branchProtectionRoutes);
app.route("/admin", adminRoutes);
app.route("/tokens", tokenRoutes);
app.route("/users", userRoutes);
app.route("/invitations", invitationRoutes);
app.route("/email-settings", emailSettingsRoutes);

export default {
  port: Number(env.PORT),
  fetch: app.fetch,
};

