import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  MyParcelError,
  fetchSenderProfile,
  getConsignmentNote,
  normalizeMpaSendMethod,
  normalizeProviderCode,
  parseMpaRates,
  quoteRates,
} from "../src/services/myParcel.service";

/**
 * MyParcel Asia v3 rate contract. Parsing and the request body are pinned with
 * fixtures; the live call is injected, so no test touches the network.
 */

const ORIGIN = "http://example.com";
let cookie: string;

async function signup(): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "MPA Tester",
      email: `mpa-${crypto.randomUUID()}@example.com`,
      password: "correct horse battery",
    }),
  });
  expect(response.status).toBe(201);
  return (response.headers.get("set-cookie") as string).split(";")[0] as string;
}

function fixture(overrides: Record<string, unknown> = {}): unknown {
  return {
    message: "Success",
    data: {
      rates: [
        {
          provider_code: "jnt",
          provider_label: "J&T Express",
          normal_price: "8.50",
          exclusive_price: "7.90",
        },
        {
          provider_code: "poslaju",
          provider_label: "PosLaju",
          normal_price: "9.20",
          exclusive_price: "8.60",
        },
        {
          provider_code: "jnt",
          provider_label: "J&T Express",
          normal_price: "7.20",
          exclusive_price: "6.80",
          transit_time: "1-5 days",
          send_methods: ["pickup", "dropoff"],
          send_dates: ["2026-11-26", "2026-11-27"],
        },
      ],
    },
    topup: "normal",
    meta: { currency_code: "MYR", currency_label: "RM", topup_balance: "100.00" },
    ...overrides,
  };
}

beforeAll(async () => {
  cookie = await signup();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Saving the connection reads the account profile before it is stored. */
function stubMpaProfile(): void {
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
}

describe("MyParcel Asia rate parsing", () => {
  it("normalises the saved send-method label to MPA's lowercase value", () => {
    expect(normalizeMpaSendMethod("Dropoff")).toBe("dropoff");
    expect(normalizeMpaSendMethod("Pickup")).toBe("pickup");
    expect(normalizeMpaSendMethod("pickup")).toBe("pickup");
    expect(normalizeMpaSendMethod(undefined)).toBe("dropoff");
    expect(normalizeMpaSendMethod("")).toBe("dropoff");
    expect(normalizeMpaSendMethod("courier")).toBe("dropoff");
  });

  it("normalises provider codes", () => {
    expect(normalizeProviderCode("J&T")).toBe("jnt");
    expect(normalizeProviderCode("J&T Express")).toBe("jnt");
    expect(normalizeProviderCode("ninja van")).toBe("ninjavan");
    expect(normalizeProviderCode("PosLaju")).toBe("poslaju");
    expect(normalizeProviderCode("FedEx")).toBe("fedex");
  });

  it("keeps the cheapest service per provider in normal mode", () => {
    const prices = parseMpaRates(fixture());
    expect(prices.get("jnt")).toMatchObject({
      priceCents: 720,
      providerCode: "jnt",
      providerLabel: "J&T Express",
      transitTime: "1-5 days",
      sendMethods: ["pickup", "dropoff"],
      sendDates: ["2026-11-26", "2026-11-27"],
    });
    expect(prices.get("poslaju")?.priceCents).toBe(920);
  });

  it("uses exclusive prices for an exclusive topup account", () => {
    const prices = parseMpaRates(fixture({ topup: "exclusive" }));
    expect(prices.get("jnt")?.priceCents).toBe(680);
    expect(prices.get("poslaju")?.priceCents).toBe(860);
  });

  it("accepts rates keyed by provider instead of an array", () => {
    const prices = parseMpaRates({
      data: {
        rates: {
          jnt: { provider_code: "jnt", normal_price: "6.00" },
          ninjavan: { provider_code: "ninjavan", normal_price: 7.4 },
        },
      },
      topup: "normal",
      meta: { currency_code: "MYR" },
    });
    expect(prices.get("jnt")?.priceCents).toBe(600);
    expect(prices.get("ninjavan")?.priceCents).toBe(740);
  });

  it("rejects non-MYR and empty rate responses", () => {
    expect(() => parseMpaRates(fixture({ meta: { currency_code: "USD" } }))).toThrow(
      MyParcelError,
    );
    expect(() => parseMpaRates({ message: "Invalid API Key", data: [] })).toThrow(MyParcelError);
  });
});

describe("MyParcel Asia account profile", () => {
  const profileBody = {
    status: true,
    message: "success",
    data: {
      sender_name: "Izwan Wahab",
      sender_phone: "60182798114",
      sender_email: "robotys@gmail.com",
      sender_address_line_1: "R-05-3A, EMPORIS, PERSIARAN SURIAN,",
      sender_address_line_2: "KOTA DAMANSARA",
      sender_address_line_3: null,
      sender_address_line_4: null,
      sender_postcode: "47810",
      sender_state: null,
      sender_state_code: "SGR",
    },
  };

  it("reads the sender identity from /user and joins the address lines", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const profile = await fetchSenderProfile("app.myparcelasia.com", "mpa_key", {
      fetchImpl: async (input, init) => {
        seenUrl = String(input);
        seenInit = init;
        return new Response(JSON.stringify(profileBody), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    expect(seenUrl).toBe("https://app.myparcelasia.com/apiv2/user");
    expect(seenInit?.method).toBe("POST");
    expect(JSON.parse(String(seenInit?.body))).toEqual({ api_key: "mpa_key" });
    expect(profile).toEqual({
      name: "Izwan Wahab",
      phone: "60182798114",
      email: "robotys@gmail.com",
      address: "R-05-3A, EMPORIS, PERSIARAN SURIAN, KOTA DAMANSARA",
      postcode: "47810",
      state: "Selangor",
    });
  });

  it("surfaces MPA's rejection without echoing the key", async () => {
    await expect(
      fetchSenderProfile("app.myparcelasia.com", "secret_key_1234", {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              status: false,
              message: [{ message: "Invalid API key" }],
              data: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      }),
    ).rejects.toMatchObject({
      code: "invalid_response",
      message: "MyParcel Asia rejected the API Key: Invalid API key",
    });
  });

  it("refuses a profile without a 5-digit sender postcode", async () => {
    await expect(
      fetchSenderProfile("app.myparcelasia.com", "mpa_key", {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              ...profileBody,
              data: { ...profileBody.data, sender_postcode: null },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("MyParcel Asia request", () => {
  it("posts the documented v3 body with the stored sender postcode", async () => {
    stubMpaProfile();
    const created = await SELF.fetch(`${ORIGIN}/api/integrations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        provider: "myparcel-asia",
        name: "MPA Test",
        fields: {
          host: "app.myparcelasia.com",
          apiKey: "mpa_test_key",
          apiSecret: "mpa_test_secret",
        },
      }),
    });
    expect(created.status).toBe(201);

    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const result = await quoteRates(
      env,
      { receiverPostcode: "88000", weightKg: 1.25 },
      {
        skipCache: true,
        fetchImpl: async (input, init) => {
          seenUrl = String(input);
          seenInit = init;
          return new Response(JSON.stringify(fixture()), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    );

    expect(seenUrl).toBe("https://app.myparcelasia.com/apiv3/check_price");
    expect(seenInit?.method).toBe("POST");
    const body = JSON.parse(String(seenInit?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      api_key: "mpa_test_key",
      sender_postcode: "60000",
      receiver_postcode: "88000",
      declared_weight: 1.25,
    });
    expect(JSON.stringify(body)).not.toContain("mpa_test_secret");
    expect(typeof result.integrationId).toBe("number");
    expect(result.integrationId).toBeGreaterThan(0);
    expect(result.rates.get("jnt")?.priceCents).toBe(720);
    expect(result.rates.get("jnt")?.providerLabel).toBe("J&T Express");
  });

  it("downloads one combined consignment-note PDF for the tracking numbers", async () => {
    let seenBody: Record<string, unknown> | undefined;
    const pdf = new TextEncoder().encode("%PDF-1.3\ncombined labels");
    const bytes = await getConsignmentNote(
      env,
      undefined,
      ["632218977105", " 632217010920 ", "632218977105"],
      {
        fetchImpl: async (_input, init) => {
          seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return new Response(pdf, {
            status: 200,
            headers: { "Content-Type": "application/pdf" },
          });
        },
      },
    );

    expect(seenBody?.tracking_no).toEqual(["632218977105", "632217010920"]);
    expect(seenBody?.api_key).toBe("mpa_test_key");
    expect(new TextDecoder().decode(new Uint8Array(bytes).slice(0, 5))).toBe("%PDF-");
  });

  it("turns a non-PDF label answer into a readable error", async () => {
    await expect(
      getConsignmentNote(env, undefined, ["632218977105"], {
        fetchImpl: async () =>
          new Response(JSON.stringify({ status: false, message: "Shipment not found" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      }),
    ).rejects.toMatchObject({
      code: "invalid_response",
      message: /Shipment not found/,
    });
  });

  it("serves a second identical quote from KV without calling MPA", async () => {
    const first = await quoteRates(
      env,
      { receiverPostcode: "50000", weightKg: 2 },
      {
        fetchImpl: async () =>
          new Response(JSON.stringify(fixture()), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      },
    );
    expect(first.rates.get("jnt")?.priceCents).toBe(720);
    expect(first.rates.get("jnt")?.transitTime).toBe("1-5 days");

    const second = await quoteRates(
      env,
      { receiverPostcode: "50000", weightKg: 2 },
      {
        fetchImpl: async () => {
          throw new Error("cache miss");
        },
      },
    );
    expect(second.rates.get("jnt")?.priceCents).toBe(720);
  });

  it("maps a provider failure to a typed error", async () => {
    await expect(
      quoteRates(
        env,
        { receiverPostcode: "40000", weightKg: 1 },
        {
          skipCache: true,
          fetchImpl: async () => new Response("nope", { status: 500 }),
        },
      ),
    ).rejects.toMatchObject({ code: "request_failed" });
  });
});
