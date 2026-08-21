// Writes the branch protection rule snapshot that the pre-receive hook reads.
// Hooks run as plain shell and cannot reach the database, so every rule
// change refreshes this file next to the bare repo.
import fs from "node:fs/promises";
import path from "node:path";

export function protectionSnapshotPath(repoPath: string): string {
  // The snapshot lives in the repo's sibling _protection folder (outside the
  // repo itself, so it is never part of git history). The folder is anchored
  // to the repo's real parent: env.SIGIT_PROJECTS_ROOT is the default but the
  // tests pass a tmpdir root, and the hook derives the same path from $0.
  const name = path.basename(repoPath);
  const parent = path.dirname(path.resolve(repoPath));
  const dir = path.join(parent, "_protection");
  return path.join(dir, `${name}.snapshot`);
}

export async function writeProtectionSnapshot(repoPath: string, json: string): Promise<void> {
  const file = protectionSnapshotPath(repoPath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, json, "utf8");
}

export async function readProtectionSnapshot(repoPath: string): Promise<string | null> {
  try {
    return await fs.readFile(protectionSnapshotPath(repoPath), "utf8");
  } catch {
    return null;
  }
}
