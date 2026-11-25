import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * /api/shipping-zones — delivery rates for the Shipping Zone page. The tests
 * cover the money invariant (Follow API stores no amount, the others require
 * one), the one-rate-per-route rule, and the normal CRUD path.
 */

const ORIGIN = "http://example.com";
let cookie: string;

async function signup(): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Shipping Tester",
      email: `shipping-${crypto.randomUUID()}@example.com`,
      password: "correct horse battery",
    }),
  });
  expect(response.status).toBe(201);
  return (response.headers.get("set-cookie") as string).split(";")[0] as string;
}

const headers = () => ({ "Content-Type": "application/json", Cookie: cookie });

const validRate = (overrides: Record<string, unknown> = {}) => ({
  zoneKey: "my-johor",
  courierKey: "jnt",
  priceType: "flat",
  priceCents: 800,
  ...overrides,
});

async function create(overrides: Record<string, unknown> = {}): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/shipping-zones`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(validRate(overrides)),
  });
}

beforeAll(async () => {
  cookie = await signup();
});

describe("shipping zones API", () => {
  it("rejects signed-out reads and writes", async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/shipping-zones`)).status).toBe(401);
    const write = await SELF.fetch(`${ORIGIN}/api/shipping-zones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validRate()),
    });
    expect(write.status).toBe(401);
  });

  it("creates a flat rate with a public shz id", async () => {
    const response = await create();
    expect(response.status).toBe(201);
    const zone = (await response.json()) as {
      id: string;
      zoneKey: string;
      courierKey: string;
      priceType: string;
      priceCents: number | null;
      status: string;
      createdAt: string;
      updatedAt: string;
    };
    expect(zone.id).toMatch(/^shz-[0-9a-f-]{36}$/);
    expect(zone.zoneKey).toBe("my-johor");
    expect(zone.courierKey).toBe("jnt");
    expect(zone.priceType).toBe("flat");
    expect(zone.priceCents).toBe(800);
    expect(zone.status).toBe("active");
    expect(zone.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("lists saved rates newest first", async () => {
    await create({ zoneKey: "my-kedah", courierKey: "ninjavan", priceCents: 900 });
    const response = await SELF.fetch(`${ORIGIN}/api/shipping-zones`, {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { shippingZones: { zoneKey: string }[] };
    expect(body.shippingZones[0]?.zoneKey).toBe("my-kedah");
    expect(body.shippingZones.some((zone) => zone.zoneKey === "my-johor")).toBe(true);
  });

  it("refuses a second rate for the same zone and courier", async () => {
    const response = await create({ priceCents: 1200 });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("shipping_zone_exists");
  });

  it("stores no amount for Follow API and rejects one supplied anyway", async () => {
    const accepted = await create({
      zoneKey: "my-perak",
      courierKey: "poslaju",
      priceType: "api",
      priceCents: null,
    });
    expect(accepted.status).toBe(201);
    const zone = (await accepted.json()) as { priceCents: number | null; priceType: string };
    expect(zone.priceType).toBe("api");
    expect(zone.priceCents).toBeNull();

    const rejected = await create({
      zoneKey: "my-selangor",
      courierKey: "aramex",
      priceType: "api",
      priceCents: 500,
    });
    expect(rejected.status).toBe(422);
    const body = (await rejected.json()) as { error: { fields?: Record<string, string> } };
    expect(body.error.fields?.priceCents).toBeTruthy();
  });

  it("requires an amount for flat and markup rates", async () => {
    const response = await create({
      zoneKey: "my-pahang",
      courierKey: "fedex",
      priceType: "markup",
      priceCents: null,
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { fields?: Record<string, string> } };
    expect(body.error.fields?.priceCents).toBeTruthy();
  });

  it("rejects unknown zone and courier keys", async () => {
    const response = await create({ zoneKey: "atlantis", courierKey: "pigeon" });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { fields?: Record<string, string> } };
    expect(body.error.fields?.zoneKey).toBeTruthy();
    expect(body.error.fields?.courierKey).toBeTruthy();
  });

  it("updates the amount, type and status", async () => {
    const created = await create({
      zoneKey: "my-sabah",
      courierKey: "jnt",
      priceCents: 1500,
    });
    const zone = (await created.json()) as { id: string; createdAt: string };

    const response = await SELF.fetch(`${ORIGIN}/api/shipping-zones/${zone.id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({
        zoneKey: "my-sabah",
        courierKey: "jnt",
        priceType: "markup",
        priceCents: 350,
        status: "inactive",
      }),
    });
    expect(response.status).toBe(200);
    const updated = (await response.json()) as {
      priceType: string;
      priceCents: number;
      status: string;
      createdAt: string;
    };
    expect(updated.priceType).toBe("markup");
    expect(updated.priceCents).toBe(350);
    expect(updated.status).toBe("inactive");
    expect(updated.createdAt).toBe(zone.createdAt);
  });

  it("deletes a rate and then reports it missing", async () => {
    const created = await create({ zoneKey: "my-labuan", courierKey: "jnt" });
    const zone = (await created.json()) as { id: string };

    const removed = await SELF.fetch(`${ORIGIN}/api/shipping-zones/${zone.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(removed.status).toBe(204);

    const missing = await SELF.fetch(`${ORIGIN}/api/shipping-zones/${zone.id}`, {
      headers: { Cookie: cookie },
    });
    expect(missing.status).toBe(404);
  });
});
