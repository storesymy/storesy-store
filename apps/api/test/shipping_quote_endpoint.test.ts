import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * POST /api/public/shipping-quote — the cart's signed-out pricing probe. The
 * page allowlist and destination validation are the same as order creation;
 * only the amount/method leaves the server.
 */

const ORIGIN = "http://example.com";
let cookie: string;
let slug: string;
let physicalId: string;
let digitalId: string;

async function signup(): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Quote API Tester",
      email: `quote-api-${crypto.randomUUID()}@example.com`,
      password: "correct horse battery",
    }),
  });
  expect(response.status).toBe(201);
  return (response.headers.get("set-cookie") as string).split(";")[0] as string;
}

const jsonHeaders = () => ({ "Content-Type": "application/json", Cookie: cookie });

async function createProduct(name: string, type: "physical" | "digital"): Promise<string> {
  const created = await SELF.fetch(`${ORIGIN}/api/products`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ name, type }),
  });
  expect(created.status).toBe(201);
  const product = (await created.json()) as { id: string };
  const updated = await SELF.fetch(`${ORIGIN}/api/products/${product.id}`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify({
      price: 1000,
      ...(type === "physical"
        ? { weightKg: 1, widthCm: 20, heightCm: 10, lengthCm: 30 }
        : { fulfilment: { shipment: false, download: true } }),
    }),
  });
  expect(updated.status).toBe(200);
  return product.id;
}

async function addZone(input: Record<string, unknown>): Promise<void> {
  const response = await SELF.fetch(`${ORIGIN}/api/shipping-zones`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ status: "active", priceType: "flat", ...input }),
  });
  expect(response.status).toBe(201);
}

async function quote(body: unknown): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/public/shipping-quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface QuoteBody {
  available: boolean;
  source: string | null;
  shippingCents: number;
  zoneKey: string | null;
  courierKey: string | null;
  priceType: string | null;
  reason?: string;
}

beforeAll(async () => {
  cookie = await signup();
  physicalId = await createProduct("Quote Physical", "physical");
  digitalId = await createProduct("Quote Digital", "digital");
  const created = await SELF.fetch(`${ORIGIN}/api/salespages`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      name: "Quote Page",
      slug: `quote-page-${crypto.randomUUID().slice(0, 8)}`,
      products: [physicalId, digitalId],
    }),
  });
  expect(created.status).toBe(201);
  slug = ((await created.json()) as { slug: string }).slug;

  await addZone({ zoneKey: "my-selangor", courierKey: "jnt", priceCents: 500 });
  await addZone({ zoneKey: "my-johor", courierKey: "jnt", priceType: "api", priceCents: null });
});

describe("public shipping quote API", () => {
  it("prices an allowlisted cart for a destination, signed out", async () => {
    const response = await quote({
      slug,
      items: [{ product: physicalId, qty: 1 }],
      destination: { country: "MY", state: "Selangor", postcode: "50000" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as QuoteBody;
    expect(body).toMatchObject({
      available: true,
      source: "zone",
      shippingCents: 500,
      zoneKey: "my-selangor",
      courierKey: "jnt",
      priceType: "flat",
    });
  });

  it("asks for a postcode before a live-rate zone can be quoted", async () => {
    const response = await quote({
      slug,
      items: [{ product: physicalId, qty: 1 }],
      destination: { country: "MY", state: "Johor" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as QuoteBody;
    expect(body.available).toBe(false);
    expect(body.reason).toBe("destination_incomplete");
  });

  it("rejects products that are not on the page", async () => {
    const other = await createProduct("Not On Page", "physical");
    const response = await quote({
      slug,
      items: [{ product: other, qty: 1 }],
      destination: { country: "MY", state: "Selangor", postcode: "50000" },
    });
    expect(response.status).toBe(422);
  });

  it("rejects an unknown page", async () => {
    const response = await quote({
      slug: "missing-page",
      items: [{ product: physicalId, qty: 1 }],
      destination: { country: "MY", state: "Selangor", postcode: "50000" },
    });
    expect(response.status).toBe(404);
  });

  it("returns free shipping for a digital-only cart", async () => {
    const response = await quote({
      slug,
      items: [{ product: digitalId, qty: 1 }],
      destination: { country: "MY", state: "Selangor", postcode: "50000" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as QuoteBody;
    expect(body.available).toBe(true);
    expect(body.shippingCents).toBe(0);
  });
});
