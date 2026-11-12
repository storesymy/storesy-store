import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          // Test-only encryption key: the crypto suite and the integration
          // endpoints need a key in every environment, and CI has no .dev.vars.
          // Real keys: `wrangler secret put INTEGRATIONS_KEY` (deploy) and
          // apps/api/.dev.vars (local) — never committed.
          INTEGRATIONS_KEY: "ia3HL4rNmw65ETKO+CsoJWiv+usgDb+9tKuT+EfJsxI=",
          // Test-only Google OAuth client: the real secret never reaches CI.
          // Tests drive token/userinfo/Gmail through injected fetch doubles.
          GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
          GOOGLE_CLIENT_SECRET: "test-client-secret",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
