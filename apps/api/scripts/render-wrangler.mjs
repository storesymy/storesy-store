import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "jsonc-parser";

/**
 * Render the account-specific Wrangler config used by CI.
 *
 * The committed `wrangler.jsonc` stays local-development friendly (placeholder
 * IDs). This script reads it, injects the resources of ONE Cloudflare account
 * from the GitHub Environment, and writes `wrangler.deploy.jsonc`. The output
 * is gitignored and never contains secrets.
 */

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(appDir, "wrangler.jsonc");
const outputPath = resolve(appDir, "wrangler.deploy.jsonc");

const PLACEHOLDER_D1 = "00000000-0000-0000-0000-000000000000";
const PLACEHOLDER_KV = "00000000000000000000000000000000";

function required(name) {
  const value = (process.env[name] ?? "").trim();
  if (value === "") {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

const accountId = required("CLOUDFLARE_ACCOUNT_ID");
const workerName = required("WORKER_NAME");
const d1DatabaseId = required("D1_DATABASE_ID");
const kvNamespaceId = required("KV_NAMESPACE_ID");
const r2BucketName = required("R2_BUCKET_NAME");
const workersSubdomain = required("WORKERS_SUBDOMAIN");

if (d1DatabaseId === PLACEHOLDER_D1) {
  console.error("D1_DATABASE_ID is still the placeholder — create the account's D1 database first.");
  process.exit(1);
}
if (kvNamespaceId === PLACEHOLDER_KV) {
  console.error("KV_NAMESPACE_ID is still the placeholder — create the account's KV namespace first.");
  process.exit(1);
}

const webOrigin = required("WEB_ORIGIN");
const apiOrigin =
  (process.env.API_ORIGIN ?? "").trim() ||
  `https://${workerName}.${workersSubdomain}.workers.dev`;
// The shared Google OAuth client ID is public; it rides along as a plain var.
// The client SECRET never touches this file — CI sets it with wrangler secret.
const googleClientId = (process.env.GOOGLE_CLIENT_ID ?? "").trim();

const config = parse(readFileSync(sourcePath, "utf8"));
if (!config || typeof config !== "object") {
  console.error(`Could not parse ${sourcePath}`);
  process.exit(1);
}

config.account_id = accountId;
config.name = workerName;

if (!Array.isArray(config.d1_databases) || config.d1_databases.length === 0) {
  console.error("wrangler.jsonc is missing d1_databases[0]");
  process.exit(1);
}
if (!Array.isArray(config.kv_namespaces) || config.kv_namespaces.length === 0) {
  console.error("wrangler.jsonc is missing kv_namespaces[0]");
  process.exit(1);
}
if (!Array.isArray(config.r2_buckets) || config.r2_buckets.length === 0) {
  console.error("wrangler.jsonc is missing r2_buckets[0]");
  process.exit(1);
}

config.d1_databases[0].database_id = d1DatabaseId;
config.kv_namespaces[0].id = kvNamespaceId;
config.r2_buckets[0].bucket_name = r2BucketName;

config.vars = {
  ...(config.vars ?? {}),
  ENVIRONMENT: "production",
  WEB_ORIGIN: webOrigin,
  PBKDF2_ITERATIONS: "100000",
  ...(googleClientId !== "" ? { GOOGLE_CLIENT_ID: googleClientId } : {}),
};

writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`);

// Later workflow steps read these without duplicating the derivation.
if (process.env.GITHUB_ENV) {
  appendFileSync(
    process.env.GITHUB_ENV,
    `WEB_ORIGIN=${webOrigin}\nAPI_ORIGIN=${apiOrigin}\n`,
  );
}

console.log(`Rendered ${outputPath}`);
console.log(`Worker: ${workerName} (${accountId})`);
console.log(`Web origin: ${webOrigin}`);
console.log(`API origin: ${apiOrigin}`);
