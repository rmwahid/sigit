import { db } from "@/config/db";
import { eq, getTableColumns } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

// Deletes one row by its primary key `id` and reports whether a row existed.
// Shared by every module whose delete path is identical (dry_violation).
export async function deleteRowById<T extends PgTable>(table: T, id: string): Promise<boolean> {
  const idColumn = getTableColumns(table).id as PgColumn | undefined;
  if (!idColumn) throw new Error("deleteRowById requires an id column");
  const rows = await db.delete(table).where(eq(idColumn, id)).returning();
  return rows.length > 0;
}
