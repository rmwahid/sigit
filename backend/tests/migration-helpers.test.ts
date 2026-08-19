import { describe, expect, it } from "bun:test";
import {
  generateMigrationName,
  generateTimestamp,
  parseMigrationFilename,
  validateMigrationDescription,
} from "@/db/utils/migration-helpers";

describe("migration helpers", () => {
  it("validates description format", () => {
    expect(validateMigrationDescription("add_user_fields")).toBe(true);
    expect(validateMigrationDescription("update_auth_schema")).toBe(true);
    expect(validateMigrationDescription("Add_User_Fields")).toBe(false);
    expect(validateMigrationDescription("add-user-fields")).toBe(false);
    expect(validateMigrationDescription("add__user__fields")).toBe(false);
    expect(validateMigrationDescription("")).toBe(false);
  });

  it("generates a timestamped migration name", () => {
    const name = generateMigrationName("add_user_fields");
    const parsed = parseMigrationFilename(`${name}.sql`);
    expect(parsed).not.toBeNull();
    expect(parsed?.description).toBe("add_user_fields");
    expect(parsed?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("parses only well-formed migration filenames", () => {
    expect(parseMigrationFilename("2026_01_02_03_04_05_add_x.sql")?.description).toBe("add_x");
    expect(parseMigrationFilename("random.sql")).toBeNull();
    expect(parseMigrationFilename("2026-01-02_add_x.sql")).toBeNull();
  });

  it("generateTimestamp is zero-padded", () => {
    expect(generateTimestamp()).toMatch(/^\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}$/);
  });
});
