import path from "node:path";
import { env } from "../config/env";

export const MAX_UPLOAD_SIZE_BYTES = Number(env.MAX_UPLOAD_SIZE_BYTES);
export const MAX_UPLOAD_FILES = Number(env.MAX_UPLOAD_FILES);

export function validateFilePath(relativePath: string): string | null {
  if (!relativePath || relativePath.length === 0) return "File path is required";
  if (relativePath.includes("\0")) return "File path contains null byte";
  if (relativePath.length > 1024) return "File path is too long";
  const normalized = relativePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  for (const part of parts) {
    if (part === ".." || part === "." || part === "") return "File path contains invalid segments";
    if (/^[a-zA-Z]:/.test(part)) return "File path contains drive letter";
  }
  return null;
}

export function validateRepoPath(repoPath: string): string | null {
  if (!repoPath || repoPath.length === 0) return "repoPath is required";
  if (repoPath.includes("\0")) return "repoPath contains null byte";
  if (repoPath.length > 4096) return "repoPath is too long";
  if (!path.isAbsolute(repoPath)) return "repoPath must be an absolute path";
  const normalized = repoPath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter((p) => p.length > 0);
  for (const part of parts) {
    if (part === ".." || part === ".") return "repoPath contains invalid segments";
  }
  return null;
}

export function validateUploadFiles(
  files: { relativePath: string; size: number }[]
): string | null {
  if (files.length === 0) return "No files";
  if (files.length > MAX_UPLOAD_FILES) {
    return `Too many files: ${files.length} (max ${MAX_UPLOAD_FILES})`;
  }
  for (const file of files) {
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      return `File too large: ${file.relativePath} (${file.size} bytes, max ${MAX_UPLOAD_SIZE_BYTES})`;
    }
    const pathError = validateFilePath(file.relativePath);
    if (pathError) return `${pathError}: ${file.relativePath}`;
  }
  return null;
}
