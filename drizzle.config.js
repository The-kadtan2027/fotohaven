/** @type { import("drizzle-kit").Config } */
export default {
  schema: "./src/lib/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL || "local.db",
  },
};
