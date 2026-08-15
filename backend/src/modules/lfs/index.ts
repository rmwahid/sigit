import crypto from "node:crypto";
import type { Project } from "@/db/schema/projects";

export function sha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function createLfsPointer(oid: string, size: number): string {
  return `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${size}\n`;
}

export function parseLfsPointer(content: string): { oid: string; size: number } | null {
  const lines = content.split("\n");
  const oidLine = lines.find((l) => l.startsWith("oid sha256:"));
  const sizeLine = lines.find((l) => l.startsWith("size "));
  if (!oidLine || !sizeLine) return null;
  return {
    oid: oidLine.replace("oid sha256:", ""),
    size: Number(sizeLine.replace("size ", "")),
  };
}

export function shouldUseLfs(project: Project, buffer: Buffer, relativePath: string): boolean {
  if (buffer.length >= project.lfsSizeThreshold) return true;
  const patterns = (project.lfsPatterns ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  return patterns.some((pattern) => matchPattern(relativePath, pattern));
}

function matchPattern(filePath: string, pattern: string): boolean {
  const regex = new RegExp(
    "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
  );
  return regex.test(filePath);
}
