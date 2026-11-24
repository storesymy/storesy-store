import { env } from "cloudflare:test";
import { createSession } from "../src/services/session.service";

/**
 * A signed-in account seeded directly. Self-signup is first-user-only, so
 * tests that need a second account (a viewer, a separate operator) must not
 * go through /api/auth/signup — they insert a row and mint a session here.
 */
export async function seedSession(
  role = "admin",
): Promise<{ email: string; uuid: string; cookie: string }> {
  const uuid = `usr-${crypto.randomUUID()}`;
  const email = `seeded-${crypto.randomUUID()}@example.com`;
  await env.DB.prepare(
    "INSERT INTO users (uuid, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(uuid, email, "Seeded User", "pbkdf2-sha256$100000$AAAA$AAAA", role)
    .run();
  const token = await createSession(env, uuid, "test-agent");
  return { email, uuid, cookie: `storesy_sid=${token}` };
}
