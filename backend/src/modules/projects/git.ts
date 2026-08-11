import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

function repoCwd(repoPath: string) {
  return { cwd: repoPath };
}

export async function initRepo(repoPath: string): Promise<void> {
  await fs.mkdir(repoPath, { recursive: true });
  try {
    await execAsync("git init -b main", repoCwd(repoPath));
    await execAsync("git config user.email \"sigit@local\"", repoCwd(repoPath));
    await execAsync("git config user.name \"SiGit\"", repoCwd(repoPath));
  } catch {
    // may already be initialized
  }
}

export async function ensureGitignore(repoPath: string): Promise<void> {
  const gitignorePath = path.join(repoPath, ".gitignore");
  let content = "";
  try {
    content = await fs.readFile(gitignorePath, "utf-8");
  } catch {
    // no existing .gitignore
  }
  if (!content.includes(".sigit/")) {
    await fs.appendFile(gitignorePath, "\n.sigit/\n");
  }
}

export async function commitFiles(
  repoPath: string,
  files: { relativePath: string; content: Buffer }[],
  message: string
): Promise<{ commitHash: string }> {
  await initRepo(repoPath);
  await ensureGitignore(repoPath);

  for (const file of files) {
    const fullPath = path.join(repoPath, file.relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, file.content);
  }

  for (const file of files) {
    await execAsync(`git add "${file.relativePath}"`, repoCwd(repoPath));
  }

  await execAsync(`git commit -m "${message.replace(/"/g, "\\'")}"`, repoCwd(repoPath));
  const { stdout } = await execAsync("git rev-parse HEAD", repoCwd(repoPath));
  return { commitHash: stdout.trim() };
}

export async function getLog(repoPath: string, limit = 50): Promise<{ hash: string; date: string; message: string; author: string }[]> {
  const format = "%H%x1f%ai%x1f%s%x1f%an%x1e";
  const { stdout } = await execAsync(`git log --pretty=format:"${format}" -n ${limit}`, repoCwd(repoPath));
  if (!stdout.trim()) return [];
  return stdout
    .split("\x1e")
    .filter(Boolean)
    .map((entry) => {
      const [hash, date, message, author] = entry.split("\x1f");
      return { hash: hash.trim(), date: date.trim(), message: message.trim(), author: author.trim() };
    });
}

export async function getDiff(repoPath: string, a?: string, b?: string): Promise<string> {
  const range = a && b ? `${a}..${b}` : a ? `${a}~1..${a}` : "HEAD";
  const { stdout } = await execAsync(`git diff ${range}`, repoCwd(repoPath));
  return stdout;
}

export async function getCommitFiles(repoPath: string, hash: string): Promise<{ path: string; status: string }[]> {
  const { stdout } = await execAsync(`git diff-tree --no-commit-id --name-status -r ${hash}`, repoCwd(repoPath));
  if (!stdout.trim()) return [];
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, filePath] = line.split("\t");
      return { path: filePath, status: status ?? "?" };
    });
}

export async function resolveHead(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync("git rev-parse HEAD", repoCwd(repoPath));
    return stdout.trim();
  } catch {
    return null;
  }
}
