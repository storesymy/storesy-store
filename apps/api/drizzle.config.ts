import { defineConfig } from "drizzle-kit";

/**
 * Generates additive SQL migrations into ./db/migrations.
 * Those files are applied by `wrangler d1 migrations apply storesy`
 * (never by editing an applied migration).
 */
export default defineConfig({
  schema: "./src/models/schema.ts",
  out: "./db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: "./.drizzle/local.db",
  },
});
