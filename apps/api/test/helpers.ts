import { env } from "cloudflare:test";
import { MENU_ITEMS, isAdminRole } from "@storesy/shared";
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
  const menuAccess = MENU_ITEMS.filter(
    (item) => isAdminRole(role) || !item.adminOnly,
  ).map((item) => item.key);
  await env.DB.prepare(
    "INSERT INTO users (uuid, email, name, password_hash, role, status, data) VALUES (?, ?, ?, ?, ?, 'active', ?)",
  )
    .bind(
      uuid,
      email,
      "Seeded User",
      "pbkdf2-sha256$100000$AAAA$AAAA",
      role,
      JSON.stringify({ menuAccess }),
    )
    .run();
  const token = await createSession(env, uuid, "test-agent");
  return { email, uuid, cookie: `storesy_sid=${token}` };
}
