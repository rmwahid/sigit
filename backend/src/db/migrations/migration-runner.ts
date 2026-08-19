import { sha256 } from "@/lib/hash";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

export type MigrationFile = {
  tag: string;
  when: number;
  hash: string;
  statements: string[];
};

// Standalone migration runner for the deploy bundle (dist-deploy/dist/migrate.js).
// It mirrors drizzle-kit migrate (pg-core dialect) exactly so the two flows stay
// interchangeable: migrations are tracked in drizzle.__drizzle_migrations by the
// journal "when" timestamp, statements split on "--> statement-breakpoint", and
// the hash is sha256 of the raw file contents.
export function loadMigrations(migrationsDir: string): MigrationFile[] {
  const journalPath = path.join(migrationsDir, "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    throw new Error(`Missing migration journal: ${journalPath}`);
  }
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { tag: string; when: number }[];
  };
  return journal.entries.map((entry) => {
    const filePath = path.join(migrationsDir, `${entry.tag}.sql`);
    if (!existsSync(filePath)) {
      throw new Error(`Missing migration file: ${filePath}`);
    }
    const query = readFileSync(filePath, "utf8");
    return {
      tag: entry.tag,
      when: entry.when,
      hash: sha256(query),
      statements: query.split("--> statement-breakpoint"),
    };
  });
}

export function pendingMigrations(
  files: MigrationFile[],
  lastAppliedAt: number | null
): MigrationFile[] {
  if (lastAppliedAt === null) return files;
  return files.filter((f) => f.when > lastAppliedAt);
}

export async function runMigrations(
  migrationsDir: string,
  sql: ReturnType<typeof postgres>
): Promise<number> {
  const files = loadMigrations(migrationsDir);
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS drizzle`).simple();
  await sql.unsafe(
    `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`
  ).simple();
  const rows = await sql<{ created_at: string }[]>`
    select id, hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1
  `;
  const lastAppliedAt = rows.length > 0 ? Number(rows[0].created_at) : null;
  const pending = pendingMigrations(files, lastAppliedAt);
  if (pending.length === 0) return 0;
  await sql.begin(async (tx) => {
    for (const migration of pending) {
      for (const stmt of migration.statements) {
        await tx.unsafe(stmt).simple();
      }
      await tx`
        insert into drizzle.__drizzle_migrations (hash, created_at)
        values (${migration.hash}, ${migration.when})
      `;
    }
  });
  return pending.length;
}

async function main(): Promise<void> {
  const { env } = await import("@/config/env");
  const migrationsDir = process.argv[2] ?? "./drizzle";
  const sql = postgres(env.DATABASE_URL);
  try {
    const applied = await runMigrations(migrationsDir, sql);
    console.log(
      applied > 0
        ? `Applied ${applied} migration(s) from ${migrationsDir}`
        : "Database is up to date"
    );
  } finally {
    await sql.end();
  }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  await main();
}
