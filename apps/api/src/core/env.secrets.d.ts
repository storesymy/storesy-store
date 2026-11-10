/**
 * Secrets are provisioned per environment — `wrangler secret put
 * INTEGRATIONS_KEY` for a deploy, `apps/api/.dev.vars` (gitignored) locally —
 * never in wrangler.jsonc, so `wrangler types` never sees them. Declared
 * here so the generated worker-configuration.d.ts stays untouched.
 *
 * INTEGRATIONS_KEY: 32 raw bytes, base64. INTEGRATIONS_KEY_PREV is optional
 * and exists only while rotating (decrypt falls back to it; writes always use
 * the current key).
 */
interface Env {
  INTEGRATIONS_KEY?: string;
  INTEGRATIONS_KEY_PREV?: string;
}
