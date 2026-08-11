import { createMiddleware } from "hono/factory";
import type { User } from "../db/schema/auth";
import { validateToken } from "../modules/auth/tokens";

export type GitAuthEnv = {
  Variables: {
    user: User;
  };
};

// Auth untuk git protocol (smart HTTP + LFS): client git mengirim
// `Authorization: Basic base64(username:password)` — passwordnya adalah
// token SiGit (prefix sigit_). Username diabaikan (pola seperti GitHub PAT).
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
  // Single admin: token milik user mana pun = akses penuh. c.set user optional.
  await next();
});
