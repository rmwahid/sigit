import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export function generateTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${now.getFullYear()}_${pad(now.getMonth() + 1)}_${pad(now.getDate())}_${pad(now.getHours())}_${pad(now.getMinutes())}_${pad(now.getSeconds())}`;
}

export function validateMigrationDescription(description: string): boolean {
  if (!description || typeof description !== "string") return false;
  const pattern = /^[a-z][a-z0-9_]*[a-z0-9]$/;
  const noConsecutiveUnderscores = !description.includes("__");
  return pattern.test(description) && noConsecutiveUnderscores;
}

export function generateMigrationName(description: string): string {
  const clean = description?.trim() || "schema_update";
  if (!validateMigrationDescription(clean)) {
    throw new Error(
      `Invalid migration description format: "${clean}"\n\n` +
        "Migration description must:\n" +
        "- Be lowercase letters, numbers, and underscores only\n" +
        "- Start with a letter\n" +
        "- End with a letter or number\n" +
        "- Not have consecutive underscores\n\n" +
        "Valid examples: add_user_fields, update_auth_schema, fix_role_permissions\n" +
        "Invalid examples: Add_User_Fields, add-user-fields, add__user__fields"
    );
  }
  return `${generateTimestamp()}_${clean}`;
}

export function parseMigrationFilename(filename: string): { timestamp: string; description: string; fullName: string } | null {
  const name = filename.replace(/\.sql$/, "");
  const pattern = /^(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(.+)$/;
  const match = name.match(pattern);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, description] = match;
  return {
    timestamp: `${year}-${month}-${day} ${hour}:${minute}:${second}`,
    description,
    fullName: name,
  };
}

export function validateExistingMigrations(): { valid: { filename: string; parsed: NonNullable<ReturnType<typeof parseMigrationFilename>> }[]; invalid: string[]; total: number } {
  const migrationsDir = join(process.cwd(), "src", "db", "migrations");
  const results = { valid: [] as { filename: string; parsed: NonNullable<ReturnType<typeof parseMigrationFilename>> }[], invalid: [] as string[], total: 0 };
  if (!existsSync(migrationsDir)) return results;
  try {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    results.total = files.length;
    files.forEach((filename) => {
      const parsed = parseMigrationFilename(filename);
      if (parsed) {
        results.valid.push({ filename, parsed });
      } else {
        results.invalid.push(filename);
      }
    });
  } catch (error) {
    console.warn("Could not validate existing migrations:", (error as Error).message);
  }
  return results;
}
