import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

// Parse connection string
const connectionString = (process.env.DATABASE_URL || "file:./local.db").replace("file:", "");

const sqlite = new Database(connectionString);

// ── SQLite performance tuning (Android / low-memory target) ──
// WAL mode: allows concurrent readers while a write is in progress
sqlite.pragma("journal_mode = WAL");
// Wait up to 5 s for a lock instead of failing immediately
sqlite.pragma("busy_timeout = 5000");
// Keep 2000 pages (~8 MB) in memory — safe for a 6 GB device
sqlite.pragma("cache_size = -8000");
// Sync less aggressively — data is local, not a bank
sqlite.pragma("synchronous = NORMAL");
// Store temp tables in memory
sqlite.pragma("temp_store = MEMORY");

import { DefaultLogger } from "drizzle-orm/logger";

export const db = drizzle(sqlite, { 
  schema,
  logger: new DefaultLogger({
    writer: {
      write: (message: string) => {
        console.log(`[DB] ${message}`);
      }
    }
  })
});

