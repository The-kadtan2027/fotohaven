import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

// Parse connection string
const connectionString = (process.env.DATABASE_URL || "file:./local.db").replace("file:", "");

const sqlite = new Database(connectionString);
export const db = drizzle(sqlite, { schema });

