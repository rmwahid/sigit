// Shared SHA-256 helper (single implementation used by tokens, invitations,
// auth sessions, and LFS). Accepts strings (UTF-8) and Buffers alike.
import crypto from "node:crypto";

export function sha256(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}
