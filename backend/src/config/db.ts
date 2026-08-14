import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "./env";
import * as schema from "../db/schema";

const client = postgres(env.DATABASE_URL);

// Relational query API (db.query.<table>.findFirst/findMany) needs the schema.
export const db = drizzle(client, { schema });
