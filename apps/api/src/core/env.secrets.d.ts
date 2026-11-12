/**
 * Secrets are provisioned per environment — `wrangler secret put
 * INTEGRATIONS_KEY` / `GOOGLE_CLIENT_SECRET` for a deploy,
 * `apps/api/.dev.vars` (gitignored) locally — never in wrangler.jsonc, so
 * `wrangler types` never sees them. Declared here so the generated
 * worker-configuration.d.ts stays untouched.
 *
 * INTEGRATIONS_KEY: 32 raw bytes, base64. INTEGRATIONS_KEY_PREV is optional
 * and exists only while rotating (decrypt falls back to it; writes always use
 * the current key).
 *
 * GOOGLE_CLIENT_ID/SECRET: the shared Google OAuth client used by every
 * Gmail connection. The ID is not secret, but both are supplied the same way
 * so one environment can hold a different client if needed.
 */
interface Env {
  INTEGRATIONS_KEY?: string;
  INTEGRATIONS_KEY_PREV?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}
