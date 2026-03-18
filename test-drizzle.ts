import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./src/lib/schema";

const sqlite = new Database(':memory:');
// Create the table so query works
sqlite.exec(`CREATE TABLE "Album" ("id" text PRIMARY KEY NOT NULL, "title" text NOT NULL, "clientName" text NOT NULL, "shareToken" text NOT NULL, "password" text, "expiresAt" integer, "createdAt" integer NOT NULL, "updatedAt" integer NOT NULL);`);

const db = drizzle(sqlite, { schema });

const q = db.query.albums.findMany();
console.log("Keys:", Object.keys(q));
console.log("Proto Keys:", Object.getOwnPropertyNames(Object.getPrototypeOf(q)));

// try execute
try {
  console.log("execute:", q.execute());
} catch (e) {
  console.error("execute error", e);
}
