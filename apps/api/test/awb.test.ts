import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as batchesModel from "../src/models/batches.repository";
import * as ordersModel from "../src/models/orders.repository";
import * as integrationsRepo from "../src/models/integrations.repository";
import type { ContactData, OrderData, OrderShippingData } from "../src/models/schema";
import { generate } from "../src/services/awb.service";
import type { MpaFetch } from "../src/services/myParcel.service";

/**
 * Bulk-AWB booking. The MyParcel Asia call is injected, so the request body,
 * response parsing and the tracking write-back are all pinned without the
 * network — and no label is ever actually booked by the test suite.
 */

const ORIGIN = "http://example.com";
let cookie: string;
let integrationId: number;
let bareIntegrationId: number;
let orderSeq = 0;

async function signup(): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "AWB Tester",
      email: `awb-${crypto.randomUUID()}@example.com`,
      password: "correct horse battery",
    }),
  });
  expect(response.status).toBe(201);
  return (response.headers.get("set-cookie") as string).split(";")[0] as string;
}

beforeAll(async () => {
  cookie = await signup();
  // The connection save reads the MPA account profile; no test calls the
  // network, and the values it returns are exactly what AWB booking sends.
  vi.stubGlobal("fetch", async () =>
    new Response(
      JSON.stringify({
        status: true,
        message: "success",
        data: {
          sender_name: "Storesy",
          sender_phone: "0123456789",
          sender_email: "hello@storesy.my",
          sender_address_line_1: "12 Jalan Merdeka",
          sender_postcode: "60000",
          sender_state: "Selangor",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
  const created = await SELF.fetch(`${ORIGIN}/api/integrations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      provider: "myparcel-asia",
      name: "MPA Live",
      fields: {
        host: "app.myparcelasia.com",
        apiKey: "mpa_test_key",
        apiSecret: "mpa_test_secret",
      },
    }),
  });
  expect(created.status).toBe(201);
  const row = await integrationsRepo.findLatestConnectedIntegration(env, "myparcel-asia");
  if (!row) throw new Error("MPA integration was not stored");
  integrationId = row.id;

  // An account created by an older build stored no sender identity, only the
  // postcode. Booking from it must fail with a clear, actionable message.
  const bare = await SELF.fetch(`${ORIGIN}/api/integrations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      provider: "myparcel-asia",
      name: "MPA Legacy",
      fields: {
        host: "app.myparcelasia.com",
        apiKey: "mpa_bare_key",
        apiSecret: "mpa_bare_secret",
      },
    }),
  });
  expect(bare.status).toBe(201);
  const bareDto = (await bare.json()) as { uuid: string };
  const bareStored = await integrationsRepo.findIntegration(env, bareDto.uuid);
  if (!bareStored) throw new Error("legacy MPA integration was not stored");
  await integrationsRepo.updateIntegration(env, bareStored.uuid, {
    data: {
      ...bareStored.data,
      settings: {
        host: bareStored.data.settings.host ?? "",
        senderPostcode: bareStored.data.settings.senderPostcode ?? "",
      },
    },
  });
  bareIntegrationId = bareStored.id;
  vi.unstubAllGlobals();
});

const contact: ContactData = {
  address: "88 Jalan Ampang",
  postcode: "50450",
  city: "Kuala Lumpur",
  state: "Kuala Lumpur",
  countryCode: "MY",
};

function shipping(overrides: Partial<OrderShippingData> = {}): OrderShippingData {
  return {
    zoneKey: "my-peninsular",
    courierKey: "jnt",
    priceCents: 580,
    priceType: "api",
    provider: "myparcel-asia",
    integrationId,
    providerCode: "jnt",
    providerLabel: "J&T Express",
    transitTime: "1-5 days",
    sendDates: ["2099-01-02"],
    parcel: { weightKg: 0.6, lengthCm: 30, widthCm: 20, heightCm: 10 },
    ...overrides,
  };
}

async function seedOrder(
  shippingData: OrderShippingData | null,
  status = "paid",
): Promise<{ uuid: string; rowId: number }> {
  orderSeq += 1;
  const customer = await env.DB.prepare(
    "INSERT INTO customers (uuid, email, name) VALUES (?, ?, ?) RETURNING id",
  )
    .bind(`cus-${crypto.randomUUID()}`, `awb-buyer-${orderSeq}@example.com`, "AWB Buyer")
    .first<{ id: number }>();
  if (!customer) throw new Error("customer insert failed");
  const contactRow = await env.DB.prepare(
    "INSERT INTO customer_contact (uuid, customer_id, name, phone, data, fingerprint) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
  )
    .bind(
      `cdt-${crypto.randomUUID()}`,
      customer.id,
      "AWB Buyer",
      "0123456789",
      JSON.stringify(contact),
      `fp-${crypto.randomUUID()}`,
    )
    .first<{ id: number }>();
  if (!contactRow) throw new Error("contact insert failed");

  const now = "2026-11-26 10:00:00";
  const data: OrderData = {
    items: [
      {
        product: "prd-awb",
        name: "Plain White Tshirt",
        unitCents: 2900,
        qty: 1,
        image: null,
      },
    ],
    subtotalCents: 2900,
    shippingCents: shippingData?.priceCents ?? 0,
    totalCents: 2900 + (shippingData?.priceCents ?? 0),
    requiresShipping: Boolean(shippingData),
    ...(shippingData ? { shipping: shippingData } : {}),
    createdAt: now,
    updatedAt: now,
  };

  const order = await ordersModel.insertOrder(env, {
    uuid: `ord-${crypto.randomUUID()}`,
    salesPageId: 1,
    customerId: customer.id,
    customerContactId: contactRow.id,
    status,
    data,
  });
  return { uuid: order.uuid, rowId: order.id };
}

function mpaFetch(
  body: unknown,
): { fetchImpl: MpaFetch; calls: Array<{ url: string; init: RequestInit | undefined }> } {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl: MpaFetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, calls };
}

describe("bulk AWB booking", () => {
  it("sends the shipment and saves the returned tracking number", async () => {
    const seeded = await seedOrder(shipping());
    const fake = mpaFetch({
      status: true,
      message: "success",
      data: [
        {
          integration_order_id: seeded.uuid,
          tracking_number: "JNT123456789",
          awb_url: "https://cdn.myparcelasia.com/awb/JNT123456789.pdf",
        },
      ],
      meta: { topup_balance: "100.00" },
    });

    const result = await generate(env, [seeded.uuid], { fetchImpl: fake.fetchImpl });

    expect(result.ok).toBe(true);
    expect(result.integration).toBe("myparcel-asia");
    expect(result.integrationName).toBe("MPA Live");
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(result.shipments).toEqual([
      {
        orderId: seeded.uuid,
        orderNo: `#${String(seeded.rowId).padStart(4, "0")}`,
        trackingNo: "JNT123456789",
      },
    ]);
    expect(result.messages).toEqual([]);
    expect(result.batch).toMatchObject({
      date: result.generatedAt,
      orderCount: 1,
      couriers: ["J&T"],
      integrationName: "MPA Live",
    });
    expect(result.batch?.id).toMatch(/^bat-/);

    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0]!;
    expect(call.url).toBe("https://app.myparcelasia.com/apiv2/create_bulk_awb");
    expect(call.init?.method).toBe("POST");
    const payload = JSON.parse(String(call.init?.body)) as {
      api_key: string;
      shipments: Array<Record<string, unknown>>;
    };
    expect(payload.api_key).toBe("mpa_test_key");
    expect(payload.shipments).toHaveLength(1);
    expect(payload.shipments[0]).toMatchObject({
      integration_order_id: seeded.uuid,
      sender_postcode: "60000",
      sender_name: "Storesy",
      sender_phone: "0123456789",
      sender_email: "hello@storesy.my",
      sender_address_line_1: "12 Jalan Merdeka",
      receiver_country_code: "MY",
      receiver_postcode: "50450",
      receiver_name: "AWB Buyer",
      receiver_phone: "0123456789",
      receiver_email: "awb-buyer-1@example.com",
      receiver_address_line_1: "88 Jalan Ampang",
      receiver_city: "Kuala Lumpur",
      receiver_state: "Kuala Lumpur",
      declared_weight: 0.6,
      send_date: "2099-01-02",
      provider_code: "jnt",
      send_method: "dropoff",
      type: "parcel",
      size: "flyers_m",
      content_type: "general",
    });

    // Persisted on the order's shipping snapshot, which is what the list and
    // the order detail both read back.
    const saved = await ordersModel.findOrderByUuid(env, seeded.uuid);
    expect(saved?.order.data.shipping?.trackingNo).toBe("JNT123456789");
    expect(saved?.order.data.shipping?.awbUrl).toBe(
      "https://cdn.myparcelasia.com/awb/JNT123456789.pdf",
    );
    expect(saved?.order.data.shipping?.awbGeneratedAt).toBe(result.generatedAt);
    expect(saved?.order.data.fulfilment).toEqual({
      status: "fulfilled",
      fulfilledAt: result.generatedAt,
    });
    expect(saved?.order.batchId).toBeTypeOf("number");
    const batchRow = (await batchesModel.listBatches(env))[0];
    expect(batchRow?.uuid).toBe(result.batch?.id);
    expect(batchRow?.data.orderCount).toBe(1);
    expect(batchRow?.data.courierLabels).toEqual(["J&T"]);
  });

  it("reads tracking from MPA's nested shipments envelope", async () => {
    const first = await seedOrder(shipping());
    const second = await seedOrder(shipping());
    const fake = mpaFetch({
      status: true,
      message: "success",
      data: {
        shipments: [
          { tracking_no: "JNT-NESTED-1" },
          { tracking_no: "JNT-NESTED-2" },
        ],
      },
    });

    const result = await generate(env, [first.uuid, second.uuid], {
      fetchImpl: fake.fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(result.shipments.map((entry) => entry.trackingNo)).toEqual([
      "JNT-NESTED-1",
      "JNT-NESTED-2",
    ]);
    const savedFirst = await ordersModel.findOrderByUuid(env, first.uuid);
    const savedSecond = await ordersModel.findOrderByUuid(env, second.uuid);
    expect(savedFirst?.order.data.shipping?.trackingNo).toBe("JNT-NESTED-1");
    expect(savedSecond?.order.data.shipping?.trackingNo).toBe("JNT-NESTED-2");
    expect(result.batch).toMatchObject({ orderCount: 2, couriers: ["J&T"] });
    expect(savedFirst?.order.batchId).toBeTypeOf("number");
    expect(savedSecond?.order.batchId).toBe(savedFirst?.order.batchId);
    expect(savedFirst?.order.data.fulfilment?.status).toBe("fulfilled");
    expect(savedSecond?.order.data.fulfilment?.status).toBe("fulfilled");

    // Fulfilled orders leave the to-process queue; the batch keeps them.
    const queue = await SELF.fetch(`${ORIGIN}/api/orders/to-process`, {
      headers: { Cookie: cookie },
    });
    const queueBody = (await queue.json()) as { orders: Array<{ id: string }> };
    expect(queueBody.orders.map((order) => order.id)).not.toContain(first.uuid);
    expect(queueBody.orders.map((order) => order.id)).not.toContain(second.uuid);
  });

  it("sends the saved Pickup preference as MPA's send_method", async () => {
    const seeded = await seedOrder(shipping());
    const integration = await integrationsRepo.findIntegrationById(env, integrationId);
    if (!integration) throw new Error("MPA integration missing");
    await integrationsRepo.updateIntegration(env, integration.uuid, {
      data: {
        ...integration.data,
        settings: { ...integration.data.settings, defaultSendMethod: "Pickup" },
      },
    });
    const fake = mpaFetch({
      status: true,
      message: "success",
      data: [{ integration_order_id: seeded.uuid, tracking_number: "JNT-PICKUP-1" }],
    });

    try {
      await generate(env, [seeded.uuid], { fetchImpl: fake.fetchImpl });
    } finally {
      await integrationsRepo.updateIntegration(env, integration.uuid, {
        data: integration.data,
      });
    }

    const payload = JSON.parse(String(fake.calls[0]?.init?.body)) as {
      shipments: Array<Record<string, unknown>>;
    };
    expect(payload.shipments[0]?.send_method).toBe("pickup");
  });

  it("returns MPA's errors and leaves the order untouched", async () => {
    const seeded = await seedOrder(shipping());
    const fake = mpaFetch({
      status: false,
      message: [
        { integration_order_id: seeded.uuid, message: "Insufficient credit" },
      ],
      data: [],
    });

    const result = await generate(env, [seeded.uuid], { fetchImpl: fake.fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.shipments).toEqual([]);
    expect(result.messages).toEqual(["Insufficient credit"]);

    const saved = await ordersModel.findOrderByUuid(env, seeded.uuid);
    expect(saved?.order.data.shipping?.trackingNo).toBeUndefined();
  });

  it("refuses orders that were not priced with MyParcel Asia without calling MPA", async () => {
    const seeded = await seedOrder(shipping({ provider: null }));
    const fake = mpaFetch({ status: true, data: [] });

    const result = await generate(env, [seeded.uuid], { fetchImpl: fake.fetchImpl });

    expect(result.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
    expect(result.messages).toEqual([
      `#${String(seeded.rowId).padStart(4, "0")}: This order was not priced with MyParcel Asia.`,
    ]);
  });

  it("never books an order that already has a tracking number", async () => {
    const seeded = await seedOrder(shipping({ trackingNo: "EXISTING-123" }));
    const fake = mpaFetch({ status: true, data: [] });

    const result = await generate(env, [seeded.uuid], { fetchImpl: fake.fetchImpl });

    expect(result.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
    expect(result.messages).toEqual([
      `#${String(seeded.rowId).padStart(4, "0")}: already has tracking EXISTING-123.`,
    ]);
  });

  it("lists the generated batches over the authenticated endpoint", async () => {
    const anon = await SELF.fetch(`${ORIGIN}/api/fulfilment/batches`);
    expect(anon.status).toBe(401);

    const response = await SELF.fetch(`${ORIGIN}/api/fulfilment/batches`, {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      batches: Array<{
        id: string;
        date: string;
        orderCount: number;
        couriers: string[];
      }>;
    };
    expect(body.batches.length).toBeGreaterThan(0);
    expect(body.batches[0]?.id).toMatch(/^bat-/);
    expect(body.batches[0]?.orderCount).toBeGreaterThan(0);
    expect(body.batches[0]?.couriers.length).toBeGreaterThan(0);
  });

  it("streams one combined AWB PDF for every tracking number in the batch", async () => {
    const seeded = await seedOrder(shipping());
    const booking = mpaFetch({
      status: true,
      message: "success",
      data: [{ integration_order_id: seeded.uuid, tracking_no: "JNT-PRINT-1" }],
    });
    const generated = await generate(env, [seeded.uuid], { fetchImpl: booking.fetchImpl });
    const batchId = generated.batch?.id;
    expect(batchId).toMatch(/^bat-/);

    const url = `${ORIGIN}/api/fulfilment/batches/${batchId}/print_label`;
    expect((await SELF.fetch(url)).status).toBe(401);
    expect(
      (await SELF.fetch(`${ORIGIN}/api/fulfilment/batches/bat-nope/print_label`, {
        headers: { Cookie: cookie },
      })).status,
    ).toBe(404);

    let seen: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(new TextEncoder().encode("%PDF-1.3\nbatch labels"), {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      });
    });
    try {
      const response = await SELF.fetch(url, { headers: { Cookie: cookie } });
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/pdf");
      expect(response.headers.get("Content-Disposition")).toContain("inline");
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
      expect(seen?.tracking_no).toEqual(["JNT-PRINT-1"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("asks for the sender details when a legacy account has none", async () => {
    const seeded = await seedOrder(shipping({ integrationId: bareIntegrationId }));
    const fake = mpaFetch({ status: true, data: [] });

    const result = await generate(env, [seeded.uuid], { fetchImpl: fake.fetchImpl });

    expect(result.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
    expect(result.messages).toEqual([
      `#${String(seeded.rowId).padStart(4, "0")}: Add the sender name, phone, email and address to the MyParcel Asia integration.`,
    ]);
  });

  it("reports a success response that carries no tracking number", async () => {
    const seeded = await seedOrder(shipping());
    const fake = mpaFetch({
      status: true,
      message: "success",
      data: [{ integration_order_id: seeded.uuid, awb_url: "https://example.com/awb.pdf" }],
    });

    const result = await generate(env, [seeded.uuid], { fetchImpl: fake.fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.shipments[0]?.trackingNo).toBeNull();
    expect(result.messages).toEqual([
      `#${String(seeded.rowId).padStart(4, "0")}: AWB response had no tracking number.`,
    ]);
    const saved = await ordersModel.findOrderByUuid(env, seeded.uuid);
    expect(saved?.order.data.shipping?.trackingNo).toBeUndefined();
  });
});
