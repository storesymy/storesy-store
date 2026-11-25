import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * GET /api/orders/summary — the sidebar's paid-but-unfulfilled count. The
 * query is deliberately independent of joins: a paid order with no
 * `fulfilment` field is the old "unfulfilled" state and counts.
 */

const ORIGIN = "http://example.com";
let cookie: string;

async function signup(): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Summary Tester",
      email: `summary-${crypto.randomUUID()}@example.com`,
      password: "correct horse battery",
    }),
  });
  expect(response.status).toBe(201);
  return (response.headers.get("set-cookie") as string).split(";")[0] as string;
}

async function seed(status: string, data: Record<string, unknown>): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO orders (uuid, sales_page_id, status, data) VALUES (?, ?, ?, ?)",
  )
    .bind(`ord-${crypto.randomUUID()}`, 1, status, JSON.stringify(data))
    .run();
}

beforeAll(async () => {
  cookie = await signup();
});

describe("orders summary API", () => {
  it("requires a session", async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/orders/summary`)).status).toBe(401);
  });

  it("counts paid orders that are still unfulfilled", async () => {
    await seed("paid", {});
    await seed("paid", { fulfilment: { status: "unfulfilled" } });
    await seed("paid", { fulfilment: { status: "fulfilled" } });
    await seed("paid", { fulfilment: { status: "delivered" } });
    await seed("pending", {});
    await seed("cancelled", { fulfilment: { status: "unfulfilled" } });

    const response = await SELF.fetch(`${ORIGIN}/api/orders/summary`, {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ toProcess: 2 });
  });
});
