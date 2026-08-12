import { createMiddleware } from "hono/factory";
import type { Token, User } from "../db/schema/auth";
import { resolveTokenScope, validateToken, type TokenScope } from "../modules/auth/tokens";
import { getProjectByName } from "../modules/projects/projects";

export type GitAuthEnv = {
  Variables: {
    user: User;
    // Token yang terautentikasi - dipakai route LFS untuk cek scope per-operasi
    // (misal batch operation "upload" butuh scope write, bukan hanya di PUT).
    token: Token;
    // Scope token yang sudah di-resolve per project oleh middleware.
    tokenScope: TokenScope;
  };
};

// Operasi git mana yang butuh scope "write":
// - git-receive-pack (push)
// - LFS upload (PUT objects) - Tahap 2
function requiresWriteScope(c: { req: { method: string; path: string } }): boolean {
  const { method, path } = c.req;
  if (path.includes("git-receive-pack")) return true;
  if (method === "PUT" && path.includes("/lfs/objects/")) return true;
  return false;
}

// Auth untuk git protocol (smart HTTP + LFS): client git mengirim
// `Authorization: Basic base64(username:password)` - passwordnya adalah
// token SiGit (prefix sigit_). Username diabaikan (pola seperti GitHub PAT).
// Akses PER PROJECT: token hanya berlaku untuk project yang punya baris scope.
// "write" otomatis termasuk "read". Token expired ditolak.
export const requireGitToken = createMiddleware<GitAuthEnv>(async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header || !header.startsWith("Basic ")) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, 401);
  }
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const password = decoded.includes(":") ? decoded.split(":")[1] : decoded;
  const token = await validateToken(password);
  if (!token) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, 401);
  }
  c.set("token", token);

  // Project tidak ditemukan -> lewati cek di sini, biarkan handler yang 404
  // (format error git/LFS tetap seperti sebelumnya).
  const name = (c.req.param("name") ?? "").replace(/\.git$/, "");
  const project = name ? await getProjectByName(name) : undefined;
  if (project) {
    const scope = await resolveTokenScope(token.id, project.id);
    if (!scope) {
      return c.json({ error: { code: "FORBIDDEN", message: "Token has no access to this project" } }, 403);
    }
    const required: TokenScope = requiresWriteScope(c) ? "write" : "read";
    if (required === "write" && scope !== "write") {
      return c.json({ error: { code: "FORBIDDEN", message: `Token requires "${required}" scope for this project` } }, 403);
    }
    c.set("tokenScope", scope);
  }

  await next();
});
