import { applyD1Migrations, env } from "cloudflare:test";

/**
 * Applies the real migration files to the test database, so a migration that
 * cannot run fails CI instead of a production deploy. The SQL is bundled in
 * at build time (the test worker's filesystem is the bundle, not this repo).
 */
const files = import.meta.glob<string>("../db/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

const migrations = Object.entries(files)
  .map(([path, sql]) => ({
    name: path.split("/").pop() as string,
    queries: sql
      .split("--> statement-breakpoint")
      .map((query) => query.trim())
      .filter(Boolean),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

await applyD1Migrations(env.DB, migrations);
