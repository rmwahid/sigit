import { describe, expect, it } from "bun:test";
import { createdAt, updatedAt } from "@/db/utils/timestamps";

// Shared timestamp column factories (db/utils/timestamps.ts). The schema
// contract every table relies on lives in the column config: name, notNull,
// and a now() default (the public `name`/`notNull` props are only populated
// once the column is bound to a table).
type ColumnConfig = { name?: string; notNull?: boolean; hasDefault?: boolean };

function configOf(column: { config: ColumnConfig }): ColumnConfig {
  return column.config;
}

describe("timestamp column factories", () => {
  it("builds created_at with the shared contract", () => {
    const config = configOf(createdAt() as never);
    expect(config.name).toBe("created_at");
    expect(config.notNull).toBe(true);
    expect(config.hasDefault).toBe(true);
  });

  it("builds updated_at with the shared contract", () => {
    const config = configOf(updatedAt() as never);
    expect(config.name).toBe("updated_at");
    expect(config.notNull).toBe(true);
    expect(config.hasDefault).toBe(true);
  });

  it("returns a fresh column instance per call (per-table binding)", () => {
    // Shared instances would leak the first table's binding into every other
    // table (drizzle mutates the column when a table is built), so factories
    // must not memoize.
    expect(createdAt()).not.toBe(createdAt());
    expect(updatedAt()).not.toBe(updatedAt());
  });
});
