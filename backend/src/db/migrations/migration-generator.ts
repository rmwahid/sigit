import { execSync, spawn } from "node:child_process";
import { readdirSync, existsSync, renameSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  generateMigrationName,
  validateMigrationDescription,
  validateExistingMigrations,
} from "../utils/migration-helpers.js";

const MIGRATIONS_DIR = join(process.cwd(), "src", "db", "migrations");

function showUsage() {
  console.log("\nSiGit Migration Generator");
  console.log("========================");
  console.log("\nUsage:");
  console.log("  bun run db:generate <description>");
  console.log("\nExamples:");
  console.log("  bun run db:generate add_storage_tables");
  console.log("  bun run db:generate update_projects_schema");
  console.log("  bun run db:generate fix_foreign_keys");
  console.log("\nDescription Rules:");
  console.log("  - Lowercase letters, numbers, and underscores only");
  console.log("  - Start with a letter, end with letter or number");
  console.log("  - No consecutive underscores or spaces");
  console.log("\nGenerated Format:");
  console.log("  YYYY_MM_DD_HH_MM_SS_description.sql");
  console.log("  Example: 2026_08_03_10_30_45_add_storage_tables.sql");
}

function showValidationReport() {
  console.log("\nValidating existing migrations...");
  const validation = validateExistingMigrations();
  if (validation.total === 0) {
    console.log("No existing migrations found.");
    return;
  }
  console.log(`\nMigration Report:`);
  console.log(`  Total files: ${validation.total}`);
  console.log(`  Valid format: ${validation.valid.length}`);
  console.log(`  Invalid format: ${validation.invalid.length}`);
  if (validation.invalid.length > 0) {
    console.log("\nInvalid migration files found:");
    validation.invalid.forEach((filename) => console.log(`  - ${filename}`));
  }
  if (validation.valid.length > 0) {
    console.log("\nValid migrations:");
    validation.valid.slice(-3).forEach(({ filename, parsed }) => {
      console.log(`  - ${filename} (${parsed.description})`);
    });
    if (validation.valid.length > 3) {
      console.log(`  ... and ${validation.valid.length - 3} more`);
    }
  }
}

async function generateMigration(description: string) {
  try {
    console.log("\nSiGit Migration Generator");
    console.log("========================");

    if (!description) {
      console.error("\nMigration description is required!");
      showUsage();
      process.exit(1);
    }
    if (!validateMigrationDescription(description)) {
      console.error("\nInvalid migration description format!");
      console.error(`Given: "${description}"`);
      console.error("\nRules:");
      console.error("  - Lowercase letters, numbers, underscores only");
      console.error("  - Start with a letter, end with letter or number");
      console.error("  - No consecutive underscores");
      showUsage();
      process.exit(1);
    }

    const migrationName = generateMigrationName(description);
    console.log(`\nGenerating migration: ${migrationName}.sql`);

    const existingFiles = new Set(
      existsSync(MIGRATIONS_DIR)
        ? readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))
        : []
    );

    console.log("\nRunning drizzle-kit generate...");
    await new Promise<void>((resolve, reject) => {
      try {
        const child = spawn("bunx", ["drizzle-kit", "generate"], {
          shell: false,
          stdio: "inherit",
        });
        child.on("error", (err) => reject(err));
        child.on("close", (code) => {
          if (code === 0) return resolve();
          return reject(new Error(`drizzle-kit generate exited with code ${code}`));
        });
      } catch (err) {
        return reject(err);
      }
    });

    const currentFiles = existsSync(MIGRATIONS_DIR)
      ? readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))
      : [];
    const newFile = currentFiles.find((f) => !existingFiles.has(f));

    if (newFile) {
      const oldPath = join(MIGRATIONS_DIR, newFile);
      const newPath = join(MIGRATIONS_DIR, `${migrationName}.sql`);
      renameSync(oldPath, newPath);
      console.log(`\nRenamed: ${newFile} -> ${migrationName}.sql`);

      const journalPath = join(MIGRATIONS_DIR, "meta", "_journal.json");
      const oldTag = newFile.replace(".sql", "");
      const newTag = migrationName;
      if (existsSync(journalPath)) {
        const journalContent = readFileSync(journalPath, "utf8");
        const updatedContent = journalContent.replace(new RegExp(oldTag, "g"), newTag);
        writeFileSync(journalPath, updatedContent);
        console.log(`Updated journal: ${oldTag} -> ${newTag}`);
      }
    } else {
      console.log("No drizzle-generated migration file found to rename");
      console.log("This may mean no schema changes were detected.");
    }

    console.log("\nMigration generated successfully!");
    console.log(`File: src/db/migrations/${migrationName}.sql`);
    console.log("\nNext Steps:");
    console.log("  1. Review the generated SQL file");
    console.log("  2. Run: bun run db:migrate");
  } catch (error) {
    console.error("\nMigration generation failed!");
    if (error instanceof Error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        console.error("Troubleshooting:");
        console.error("  - Make sure drizzle-kit is installed: bun add -d drizzle-kit");
        console.error("  - Check your drizzle.config.ts configuration");
      } else {
        console.error(`Error: ${error.message}`);
      }
    }
    process.exit(1);
  }
}

function handleArguments() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    showUsage();
    return;
  }
  if (args.includes("--validate") || args.includes("-v")) {
    showValidationReport();
    return;
  }
  const description = args[0];
  if (!description) {
    console.error("Migration description is required!");
    showUsage();
    process.exit(1);
  }
  generateMigration(description);
}

handleArguments();
