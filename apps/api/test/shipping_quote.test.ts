import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import * as productsModel from "../src/models/products.repository";
import {
  computeParcel,
  quoteShipping,
} from "../src/services/shippingQuote.service";
import type { QuoteLine } from "../src/services/shippingQuote.service";

/**
 * The zone/rate resolver behind both the cart quote and order creation. MPA is
 * injected, so every branch — flat, API, markup, provider failure, missing
 * weight — is deterministic.
 */

const ORIGIN = "http://example.com";
let cookie: string;

async function signup(): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Quote Tester",
      email: `quote-${crypto.randomUUID()}@example.com`,
      password: "correct horse battery",
    }),
  });
  expect(response.status).toBe(201);
  return (response.headers.get("set-cookie") as string).split(";")[0] as string;
}

async function createProduct(
  name: string,
  patch: Record<string, unknown>,
): Promise<string> {
  const created = await SELF.fetch(`${ORIGIN}/api/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name, type: "physical" }),
  });
  expect(created.status).toBe(201);
  const body = (await created.json()) as { id: string };
  const updated = await SELF.fetch(`${ORIGIN}/api/products/${body.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ price: 1000, ...patch }),
  });
  expect(updated.status).toBe(200);
  return body.id;
}

async function addZone(input: {
  zoneKey: string;
  courierKey: string;
  priceType?: string;
  priceCents?: number | null;
}): Promise<void> {
  const response = await SELF.fetch(`${ORIGIN}/api/shipping-zones`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      priceType: "flat",
      status: "active",
      ...input,
    }),
  });
  expect(response.status).toBe(201);
}

async function line(id: string, qty = 1): Promise<QuoteLine> {
  const row = await productsModel.findProductByUuid(env, id);
  if (!row) throw new Error(`missing product ${id}`);
  return { row, qty };
}

let standardId: string;
let lightId: string;
let heavyId: string;
let digitalId: string;

beforeAll(async () => {
  cookie = await signup();
  standardId = await createProduct("Standard Parcel", {
    weightKg: 1,
    widthCm: 20,
    heightCm: 10,
    lengthCm: 30,
  });
  lightId = await createProduct("No Weight", {});
  heavyId = await createProduct("Heavy Parcel", { weightKg: 31 });
  digitalId = await createProduct("Digital", {
    fulfilment: { shipment: false, download: true },
  });
});

const mpa = (prices: Record<string, number>) => ({
  integrationId: 7,
  rates: new Map(
    Object.entries(prices).map(([code, cents]) => [
      code,
      {
        providerCode: code,
        providerLabel: code === "jnt" ? "J&T Express" : code,
        priceCents: cents,
        transitTime: "1-5 days",
        sendMethods: ["pickup", "dropoff"],
        sendDates: ["2026-11-26"],
      },
    ]),
  ),
});

describe("checkout shipping quotes", () => {
  it("uses a stored flat rate", async () => {
    await addZone({ zoneKey: "my-selangor", courierKey: "jnt", priceCents: 500 });
    const result = await quoteShipping(
      env,
      { lines: [await line(standardId)], destination: { country: "MY", state: "Selangor" } },
    );
    expect(result).toMatchObject({
      available: true,
      source: "zone",
      shippingCents: 500,
      zoneKey: "my-selangor",
      courierKey: "jnt",
      priceType: "flat",
      provider: null,
      snapshot: {
        shippingZoneId: expect.any(Number),
        zoneKey: "my-selangor",
        courierKey: "jnt",
        priceType: "flat",
        provider: null,
        priceCents: 500,
      },
    });
  });

  it("uses a MyParcel Asia quote for an API row", async () => {
    await addZone({ zoneKey: "my-johor", courierKey: "jnt", priceType: "api", priceCents: null });
    const result = await quoteShipping(
      env,
      {
        lines: [await line(standardId)],
        destination: { country: "MY", state: "Johor", postcode: "80000" },
      },
      { mpaQuote: async () => mpa({ jnt: 800 }) },
    );
    expect(result).toMatchObject({
      available: true,
      shippingCents: 800,
      priceType: "api",
      provider: "myparcel-asia",
      courierKey: "jnt",
      snapshot: {
        shippingZoneId: expect.any(Number),
        zoneKey: "my-johor",
        courierKey: "jnt",
        priceType: "api",
        provider: "myparcel-asia",
        integrationId: 7,
        providerCode: "jnt",
        providerLabel: "J&T Express",
        quotedCents: 800,
        priceCents: 800,
        transitTime: "1-5 days",
        sendMethods: ["pickup", "dropoff"],
        sendDates: ["2026-11-26"],
        parcel: {
          weightKg: 1.2,
          lengthCm: 30,
          widthCm: 20,
          heightCm: 10,
        },
        quotedAt: expect.any(String),
      },
    });
  });

  it("adds the markup amount to the live quote", async () => {
    await addZone({ zoneKey: "my-kedah", courierKey: "ninjavan", priceType: "markup", priceCents: 300 });
    const result = await quoteShipping(
      env,
      {
        lines: [await line(standardId)],
        destination: { country: "MY", state: "Kedah", postcode: "05000" },
      },
      { mpaQuote: async () => mpa({ ninjavan: 900 }) },
    );
    expect(result.shippingCents).toBe(1200);
    expect(result.priceType).toBe("markup");
    expect(result.snapshot).toMatchObject({
      quotedCents: 900,
      priceCents: 1200,
      integrationId: 7,
    });
  });

  it("charges the cheapest of a flat and a live quote in one zone", async () => {
    await addZone({ zoneKey: "my-perak", courierKey: "jnt", priceCents: 700 });
    await addZone({ zoneKey: "my-perak", courierKey: "poslaju", priceType: "api", priceCents: null });
    const result = await quoteShipping(
      env,
      {
        lines: [await line(standardId)],
        destination: { country: "MY", state: "Perak", postcode: "30000" },
      },
      { mpaQuote: async () => mpa({ poslaju: 600 }) },
    );
    expect(result.shippingCents).toBe(600);
    expect(result.courierKey).toBe("poslaju");
  });

  it("refuses an MPA failure instead of falling back to a broader flat", async () => {
    await addZone({ zoneKey: "my-all", courierKey: "jnt", priceCents: 1200 });
    await addZone({ zoneKey: "my-sabah", courierKey: "jnt", priceType: "api", priceCents: null });
    const result = await quoteShipping(
      env,
      {
        lines: [await line(standardId)],
        destination: { country: "MY", state: "Sabah", postcode: "88000" },
      },
      {
        mpaQuote: async () => {
          throw new Error("MPA down");
        },
      },
    );
    expect(result.available).toBe(false);
    expect(result.reason).toBe("provider_unavailable");
    expect(result.shippingCents).toBe(0);
  });

  it("can still use a flat row in the same zone when MPA fails", async () => {
    await addZone({ zoneKey: "my-pahang", courierKey: "jnt", priceCents: 900 });
    await addZone({ zoneKey: "my-pahang", courierKey: "poslaju", priceType: "api", priceCents: null });
    const result = await quoteShipping(
      env,
      {
        lines: [await line(standardId)],
        destination: { country: "MY", state: "Pahang", postcode: "25000" },
      },
      {
        mpaQuote: async () => {
          throw new Error("MPA down");
        },
      },
    );
    expect(result.available).toBe(true);
    expect(result.shippingCents).toBe(900);
    expect(result.priceType).toBe("flat");
  });

  it("blocks API pricing when the parcel has no weight or dimensions", async () => {
    await addZone({ zoneKey: "my-terengganu", courierKey: "jnt", priceType: "api", priceCents: null });
    const result = await quoteShipping(
      env,
      {
        lines: [await line(lightId)],
        destination: { country: "MY", state: "Terengganu", postcode: "20000" },
      },
      { mpaQuote: async () => mpa({ jnt: 500 }) },
    );
    expect(result.available).toBe(false);
    expect(result.reason).toBe("weight_missing");
  });

  it("refuses parcels over the 30 kg courier limit", async () => {
    await addZone({ zoneKey: "my-kelantan", courierKey: "jnt", priceType: "api", priceCents: null });
    const result = await quoteShipping(
      env,
      {
        lines: [await line(heavyId)],
        destination: { country: "MY", state: "Kelantan", postcode: "15000" },
      },
      { mpaQuote: async () => mpa({ jnt: 500 }) },
    );
    expect(result.available).toBe(false);
    expect(result.reason).toBe("too_heavy");
  });

  it("does not use MyParcel Asia for international API rows", async () => {
    await addZone({ zoneKey: "SG", courierKey: "aramex", priceType: "api", priceCents: null });
    let called = false;
    const result = await quoteShipping(
      env,
      {
        lines: [await line(standardId)],
        destination: { country: "SG", state: "Singapore", postcode: "018956" },
      },
      {
        mpaQuote: async () => {
          called = true;
          return mpa({});
        },
      },
    );
    expect(called).toBe(false);
    expect(result.available).toBe(false);
    expect(result.reason).toBe("no_rate");
  });

  it("returns no_rate for an unknown Malaysian state", async () => {
    const result = await quoteShipping(
      env,
      {
        lines: [await line(standardId)],
        destination: { country: "MY", state: "Atlantis" },
      },
    );
    expect(result.reason).toBe("no_rate");
  });

  it("gives a digital-only cart free shipping", async () => {
    const result = await quoteShipping(
      env,
      {
        lines: [await line(digitalId)],
        destination: { country: "MY", state: "Selangor" },
      },
    );
    expect(result).toMatchObject({ available: true, shippingCents: 0 });
  });
});

describe("parcel weight", () => {
  it("uses the greater of actual and volumetric weight per unit", async () => {
    // 20×10×30 / 5000 = 1.2 kg, which beats the 1 kg actual.
    const result = computeParcel([await line(standardId, 2)]);
    expect(result).toEqual({
      ok: true,
      weightKg: 2.4,
      dimensions: { lengthCm: 30, widthCm: 20, heightCm: 10 },
    });
  });

  it("blocks when neither weight nor dimensions exist", async () => {
    expect(computeParcel([await line(lightId)])).toEqual({
      ok: false,
      reason: "weight_missing",
    });
  });
});
