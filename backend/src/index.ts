import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { apiReference } from "@scalar/hono-api-reference";
import { env } from "./config/env";
import { authRoutes } from "./routes/auth";
import { storageRoutes } from "./routes/storage";
import { projectRoutes } from "./routes/projects";
import { requireAuth, type AuthEnv } from "./middleware/auth";

const app = new OpenAPIHono<AuthEnv>();

const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(secureHeaders());

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
app.route("/storage", storageRoutes);
app.route("/projects", projectRoutes);

export default {
  port: Number(env.PORT),
  fetch: app.fetch,
};
