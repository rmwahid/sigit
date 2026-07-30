import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./config/env";
import { storageRoutes } from "./routes/storage";
import { projectRoutes } from "./routes/projects";

const app = new Hono();

app.use(cors());

app.get("/", (c) => c.json({ message: "SiGit API" }));

app.route("/storage", storageRoutes);
app.route("/projects", projectRoutes);

export default {
  port: Number(env.PORT),
  fetch: app.fetch,
};
