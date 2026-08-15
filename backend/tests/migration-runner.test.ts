import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadMigrations,
  pendingMigrations,
  type MigrationFile,
} from "@/db/migrations/migration-runner";

function makeMigrationsDir(): { dir: string; files: MigrationFile[] } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sigit-migrations-"));
  mkdirSync(path.join(dir, "meta"), { recursive: true });
  const entries = [
    { tag: "2026_01_01_00_00_00_first", when: 1000 },
    { tag: "2026_02_02_00_00_00_second", when: 2000 },
  ];
  const files: MigrationFile[] = entries.map((e) => {
    const query = `CREATE TABLE "${e.tag}" (id int);\n--> statement-breakpoint\nALTER TABLE "${e.tag}" ADD COLUMN x int;`;
    writeFileSync(path.join(dir, `${e.tag}.sql`), query);
    return {
      tag: e.tag,
      when: e.when,
      hash: createHash("sha256").update(query).digest("hex"),
      statements: query.split("--> statement-breakpoint"),
    };
  });
  writeFileSync(
    path.join(dir, "meta", "_journal.json"),
    JSON.stringify({ version: "7", dialect: "postgresql", entries })
  );
  return { dir, files };
}

describe("migration runner (drizzle-compatible)", () => {
  it("loads journal entries, splits statements, and hashes raw contents", () => {
    const { dir, files } = makeMigrationsDir();
    try {
      const loaded = loadMigrations(dir);
      expect(loaded).toHaveLength(2);
      expect(loaded[0].statements).toHaveLength(2);
      expect(loaded[0].hash).toBe(files[0].hash);
      expect(loaded[1].tag).toBe("2026_02_02_00_00_00_second");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a missing migration file", () => {
    const { dir } = makeMigrationsDir();
    try {
      // Point the journal at an entry whose sql file does not exist.
      writeFileSync(
        path.join(dir, "meta", "_journal.json"),
        JSON.stringify({
          version: "7",
          dialect: "postgresql",
          entries: [{ tag: "2026_99_99_00_00_00_ghost", when: 1 }],
        })
      );
      expect(() => loadMigrations(dir)).toThrow(/Missing migration file/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats a null timestamp as a fresh database", () => {
    const { files } = makeMigrationsDir();
    expect(pendingMigrations(files, null)).toEqual(files);
  });

  it("keeps only migrations newer than the last applied timestamp", () => {
    const { files } = makeMigrationsDir();
    expect(pendingMigrations(files, 1000).map((f) => f.tag)).toEqual([
      "2026_02_02_00_00_00_second",
    ]);
    expect(pendingMigrations(files, 2000)).toEqual([]);
  });
});
