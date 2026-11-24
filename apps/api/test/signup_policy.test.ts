import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * Self-signup is a one-time bootstrap: the very first account becomes the
 * install's owner (an admin role), and every later signup is refused with the invite-only
 * message the login page shows.
 */

const ORIGIN = "http://example.com";
const CLOSED = "Please get invites from admin";

async function status(): Promise<{ open: boolean; message: string | null }> {
  const response = await SELF.fetch(`${ORIGIN}/api/auth/signup-status`);
  expect(response.status).toBe(200);
  return (await response.json()) as { open: boolean; message: string | null };
}

async function signup(email: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "First Admin", email, password: "correct horse battery" }),
  });
}

describe("invite-only signup", () => {
  it("reports the first-user slot as open before anyone exists", async () => {
    expect(await status()).toEqual({ open: true, message: null });
  });

  it("makes the first user the owner, then closes signup for everyone else", async () => {
    const first = await signup(`first-${crypto.randomUUID()}@example.com`);
    expect(first.status).toBe(201);
    const owner = (await first.json()) as { role: string; email: string };
    expect(owner.role).toBe("owner");

    expect(await status()).toEqual({ open: false, message: CLOSED });

    const second = await signup(`second-${crypto.randomUUID()}@example.com`);
    expect(second.status).toBe(403);
    const body = (await second.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("signup_closed");
    expect(body.error.message).toBe(CLOSED);
  });
});
