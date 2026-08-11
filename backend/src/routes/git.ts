import { Hono } from "hono";
import { handleGitRequest } from "../modules/git/server";
import { requireGitToken } from "../middleware/git-auth";

// Git smart HTTP: /projects/<name>.git/<path>
// git client memanggil: info/refs?service=git-upload-pack|git-receive-pack,
// git-upload-pack, git-receive-pack (POST dengan packfile).
export const gitRoutes = new Hono();

gitRoutes.use("*", requireGitToken);

gitRoutes.get("/:name.git/*", async (c) => {
  // Hono: pattern `:name.git` menghasilkan param bernama "name.git" (titik ikut
  // jadi bagian nama param). Ambil lalu buang suffix ".git".
  const name = (c.req.param("name.git") ?? "").replace(/\.git$/, "");
  const pathInfo = c.req.path.replace(/^\/projects\/[^/]+\.git/, "") || "/";
  return handleGitRequest(c, name, pathInfo);
});

gitRoutes.post("/:name.git/*", async (c) => {
  const name = (c.req.param("name.git") ?? "").replace(/\.git$/, "");
  const pathInfo = c.req.path.replace(/^\/projects\/[^/]+\.git/, "") || "/";
  return handleGitRequest(c, name, pathInfo);
});
