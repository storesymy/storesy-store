import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Zone-driven checkout shipping. The cart sends a total; the server resolves
 * the buyer's destination through the active rate card and charges that rate —
 * never the client's number. No zones configured falls back to the legacy flat
 * rate, so an unconfigured store keeps selling.
 */

const ORIGIN = "http://example.com";
let cookie: string;
let physicalId: string;
let digitalId: string;
let slug: string;

async function signup(): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Shipping Checkout Tester",
      email: `ship-checkout-${crypto.randomUUID()}@example.com`,
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
      ...(type === "digital"
        ? { fulfilment: { shipment: false, download: true } }
        : { weightKg: 1, widthCm: 20, heightCm: 10, lengthCm: 30 }),
    }),
  });
  expect(updated.status).toBe(200);
  return product.id;
}

async function createPage(): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/api/salespages`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      name: "Zone Checkout",
      slug: `zone-${crypto.randomUUID().slice(0, 8)}`,
      products: [physicalId, digitalId],
    }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { slug: string }).slug;
}

async function addZone(input: {
  zoneKey: string;
  courierKey: string;
  priceType?: string;
  priceCents?: number | null;
  status?: string;
}): Promise<void> {
  const response = await SELF.fetch(`${ORIGIN}/api/shipping-zones`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      priceType: "flat",
      status: "active",
      ...input,
    }),
  });
  expect(response.status).toBe(201);
}

const CUSTOMER = {
  name: "Aina Rahman",
  phone: "0123456789",
  email: "aina@example.com",
  address: "12 Jalan Merdeka",
  postcode: "50000",
  city: "Kuala Lumpur",
  state: "Selangor",
  country: "MY",
};

async function submit(
  items: { product: string; qty: number }[],
  customer: Record<string, unknown>,
  totalCents: number,
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/public/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, items, customer, totalCents }),
  });
}

interface OrderBody {
  order: {
    id: string;
    shippingCents: number;
    totalCents: number;
    requiresShipping: boolean;
    fulfilment: { status: string };
  };
}

async function placed(response: Response): Promise<OrderBody["order"]> {
  expect(response.status).toBe(201);
  return ((await response.json()) as OrderBody).order;
}

async function orderData(uuid: string): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare("SELECT data FROM orders WHERE uuid = ?")
    .bind(uuid)
    .first<{ data: string }>();
  return JSON.parse(row?.data ?? "{}") as Record<string, unknown>;
}

beforeAll(async () => {
  cookie = await signup();
  physicalId = await createProduct("Zone Physical", "physical");
  digitalId = await createProduct("Zone Digital", "digital");
  slug = await createPage();
});

describe("checkout shipping zones", () => {
  it("publishes an empty rate card with the legacy fallback", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/public/shipping-rates`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      rates: unknown[];
      fallbackCents: number;
      requiresQuote: boolean;
      couriers: { key: string; label: string }[];
    };
    expect(body.rates).toEqual([]);
    expect(body.fallbackCents).toBe(1000);
    expect(body.requiresQuote).toBe(false);
    expect(body.couriers.find((courier) => courier.key === "jnt")?.label).toBe("J&T");
  });

  it("charges the legacy flat rate until a zone exists", async () => {
    const order = await placed(
      await submit([{ product: physicalId, qty: 1 }], CUSTOMER, 2000),
    );
    expect(order.shippingCents).toBe(1000);
    expect(order.totalCents).toBe(2000);
    expect(order.requiresShipping).toBe(true);
  });

  it("refuses API-only zones when MyParcel Asia is not configured", async () => {
    await addZone({ zoneKey: "my-all", courierKey: "ninjavan", priceType: "api", priceCents: null });
    const response = await submit([{ product: physicalId, qty: 1 }], CUSTOMER, 2000);
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { fields?: Record<string, string> } };
    expect(body.error.fields?.shipping).toBeTruthy();
  });

  it("uses the most specific zone, then broader fallbacks", async () => {
    await addZone({ zoneKey: "my-all", courierKey: "jnt", priceCents: 1200 });
    await addZone({ zoneKey: "my-selangor", courierKey: "jnt", priceCents: 500 });
    await addZone({ zoneKey: "my-peninsular", courierKey: "jnt", priceCents: 700 });
    await addZone({ zoneKey: "my-sabah-sarawak", courierKey: "ninjavan", priceCents: 1800 });
    await addZone({ zoneKey: "my-johor", courierKey: "jnt", priceCents: 900 });
    await addZone({ zoneKey: "my-johor", courierKey: "poslaju", priceCents: 600 });
    await addZone({ zoneKey: "my-labuan", courierKey: "jnt", priceCents: 0 });
    await addZone({ zoneKey: "SG", courierKey: "aramex", priceCents: 2500 });
    // Paused and non-flat rows must never reach the buyer's card.
    await addZone({ zoneKey: "US", courierKey: "fedex", priceCents: 3000, status: "inactive" });
    await addZone({ zoneKey: "my-terengganu", courierKey: "fedex", priceType: "api", priceCents: null });

    const selangor = await placed(
      await submit([{ product: physicalId, qty: 1 }], CUSTOMER, 1500),
    );
    expect(selangor.shippingCents).toBe(500);

    const kedah = await placed(
      await submit(
        [{ product: physicalId, qty: 1 }],
        { ...CUSTOMER, state: "Kedah", city: "Alor Setar" },
        1700,
      ),
    );
    expect(kedah.shippingCents).toBe(700);

    const sabah = await placed(
      await submit(
        [{ product: physicalId, qty: 1 }],
        { ...CUSTOMER, state: "Sabah", city: "Kota Kinabalu", postcode: "88000" },
        2800,
      ),
    );
    expect(sabah.shippingCents).toBe(1800);

    // Cheapest flat courier for the zone wins.
    const johor = await placed(
      await submit(
        [{ product: physicalId, qty: 1 }],
        { ...CUSTOMER, state: "Johor", city: "Johor Bahru" },
        1600,
      ),
    );
    expect(johor.shippingCents).toBe(600);

    // The specific zone has only an API row; with MyParcel Asia unconfigured
    // the quote is refused rather than silently falling back to Peninsular.
    const terengganu = await submit(
      [{ product: physicalId, qty: 1 }],
      { ...CUSTOMER, state: "Terengganu", city: "Kuala Terengganu", postcode: "20000" },
      1700,
    );
    expect(terengganu.status).toBe(422);

    const singapore = await placed(
      await submit(
        [{ product: physicalId, qty: 1 }],
        { ...CUSTOMER, country: "SG", state: "Singapore", city: "Singapore", postcode: "018956" },
        3500,
      ),
    );
    expect(singapore.shippingCents).toBe(2500);
  });

  it("publishes active rates only, signed out", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/public/shipping-rates`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      rates: { zoneKey: string; priceType: string; priceCents: number | null }[];
      fallbackCents: number;
      requiresQuote: boolean;
    };
    expect(body.fallbackCents).toBe(1000);
    expect(body.requiresQuote).toBe(true);
    expect(body.rates).toHaveLength(10);
    expect(body.rates.some((rate) => rate.zoneKey === "US")).toBe(false);
    expect(
      body.rates.some((rate) => rate.zoneKey === "my-terengganu" && rate.priceType === "api"),
    ).toBe(true);
  });

  it("refuses a destination with no active flat rate", async () => {
    const response = await submit(
      [{ product: physicalId, qty: 1 }],
      { ...CUSTOMER, country: "US", state: "California", city: "Los Angeles", postcode: "90001" },
      1000,
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { fields?: Record<string, string> } };
    expect(body.error.fields?.country).toBeTruthy();

    const unknown = await submit(
      [{ product: physicalId, qty: 1 }],
      { ...CUSTOMER, state: "Atlantis" },
      1000,
    );
    expect(unknown.status).toBe(422);
    const unknownBody = (await unknown.json()) as { error: { fields?: Record<string, string> } };
    expect(unknownBody.error.fields?.state).toBeTruthy();
  });

  it("keeps a RM0 zone physical so it still needs fulfilment", async () => {
    const order = await placed(
      await submit(
        [{ product: physicalId, qty: 1 }],
        { ...CUSTOMER, state: "Labuan", city: "Victoria", postcode: "87000" },
        1000,
      ),
    );
    expect(order.shippingCents).toBe(0);
    expect(order.requiresShipping).toBe(true);
    expect(order.fulfilment.status).toBe("unfulfilled");
  });

  it("treats a digital-only cart as fulfilled and unshipped", async () => {
    const order = await placed(
      await submit(
        [{ product: digitalId, qty: 1 }],
        { name: "Aina Rahman", phone: "0123456789", email: "aina@example.com" },
        1000,
      ),
    );
    expect(order.shippingCents).toBe(0);
    expect(order.requiresShipping).toBe(false);
    expect(order.fulfilment.status).toBe("fulfilled");
  });

  it("snapshots the chosen zone and courier on the order", async () => {
    const order = await placed(
      await submit([{ product: physicalId, qty: 1 }], CUSTOMER, 1500),
    );
    const data = await orderData(order.id);
    expect(data.shipping).toEqual({
      zoneKey: "my-selangor",
      courierKey: "jnt",
      priceCents: 500,
      priceType: "flat",
      provider: null,
    });
    expect(data.requiresShipping).toBe(true);
  });
});
