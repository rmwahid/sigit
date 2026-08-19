import { describe, expect, it, afterAll } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { db } from "@/config/db";
import { deleteRowById } from "@/lib/db";
import { users, type NewUser } from "@/db/schema/auth";

// deleteRowById: shared row deletion helper. Uses a throwaway user row in the
// dev DB (FK cascade cleans nothing else for users without dependencies).
const TEST_TIMEOUT = 30000;
const suffix = Date.now().toString(36);
const createdUserIds: string[] = [];

async function makeUser(email: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: "db-test-hash" } satisfies NewUser)
    .returning({ id: users.id });
  createdUserIds.push(row.id);
  return row.id;
}

async function cleanup() {
  for (const id of createdUserIds) {
    try {
      await db.delete(users).where(eq(users.id, id));
    } catch {
      // best effort
    }
  }
}

afterAll(async () => {
  await cleanup();
}, TEST_TIMEOUT);

describe("deleteRowById", () => {
  it("deletes an existing row and reports true", async () => {
    const id = await makeUser(`db-helper-${suffix}@test.local`);
    expect(await deleteRowById(users, id)).toBe(true);
    createdUserIds.splice(createdUserIds.indexOf(id), 1);
    const rows = await db.select().from(users).where(eq(users.id, id));
    expect(rows).toHaveLength(0);
  });

  it("reports false when the row does not exist", async () => {
    const missing = randomUUID();
    expect(await deleteRowById(users, missing)).toBe(false);
  });

  it("rejects tables without an id column", async () => {
    // A real drizzle table, just one whose primary key is not named "id".
    const noIdTable = pgTable("db_helper_no_id", { name: text("name") });
    let message = "";
    try {
      await deleteRowById(noIdTable, "nope");
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toBe("deleteRowById requires an id column");
  });
});
