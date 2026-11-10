import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  firstAdminEmail,
  isUndeliverableDemoEmail,
} from "../src/models/users.repository";

/**
 * Merchant notification recipient: the earliest admin that can actually
 * receive mail. Early test accounts on reserved domains must never be chosen
 * — mailing them guarantees a bounce ("domain example.com couldn't be found").
 */

const ORIGIN = "http://example.com";

describe("notification recipient", () => {
  it("skips reserved demo domains and picks the first deliverable admin", async () => {
    const signup = await SELF.fetch(`${ORIGIN}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Demo Owner",
        email: `demo-${crypto.randomUUID()}@example.com`,
        password: "correct horse battery",
      }),
    });
    expect(signup.status).toBe(201);

    // Only reserved-domain accounts exist → no deliverable recipient.
    expect(await firstAdminEmail(env)).toBeNull();

    // A real-looking admin created later is chosen over the earlier test one.
    await env.DB.prepare(
      "INSERT INTO users (uuid, email, name, password_hash, role) VALUES (?, ?, ?, ?, 'owner')",
    )
      .bind(`usr-test_${crypto.randomUUID()}`, "owner@store.com", "Real Owner", "hash")
      .run();
    expect(await firstAdminEmail(env)).toBe("owner@store.com");
  });

  it("recognises the reserved/demo domains", () => {
    for (const email of [
      "a@example.com",
      "a@example.net",
      "a@example.org",
      "a@shop.test",
      "a@host.invalid",
      "a@local.localhost",
      "a@foo.example",
      "no-at-sign",
    ]) {
      expect(isUndeliverableDemoEmail(email)).toBe(true);
    }
    expect(isUndeliverableDemoEmail("owner@store.com")).toBe(false);
    expect(isUndeliverableDemoEmail("robotys@gmail.com")).toBe(false);
  });
});
