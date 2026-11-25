import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  MyParcelError,
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
          provider_label: "J&T Express (Express)",
          normal_price: "7.20",
          exclusive_price: "6.80",
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

describe("MyParcel Asia rate parsing", () => {
  it("normalises provider codes", () => {
    expect(normalizeProviderCode("J&T")).toBe("jnt");
    expect(normalizeProviderCode("J&T Express")).toBe("jnt");
    expect(normalizeProviderCode("ninja van")).toBe("ninjavan");
    expect(normalizeProviderCode("PosLaju")).toBe("poslaju");
    expect(normalizeProviderCode("FedEx")).toBe("fedex");
  });

  it("keeps the cheapest service per provider in normal mode", () => {
    const prices = parseMpaRates(fixture());
    expect(prices.get("jnt")).toBe(720);
    expect(prices.get("poslaju")).toBe(920);
  });

  it("uses exclusive prices for an exclusive topup account", () => {
    const prices = parseMpaRates(fixture({ topup: "exclusive" }));
    expect(prices.get("jnt")).toBe(680);
    expect(prices.get("poslaju")).toBe(860);
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
    expect(prices.get("jnt")).toBe(600);
    expect(prices.get("ninjavan")).toBe(740);
  });

  it("rejects non-MYR and empty rate responses", () => {
    expect(() => parseMpaRates(fixture({ meta: { currency_code: "USD" } }))).toThrow(
      MyParcelError,
    );
    expect(() => parseMpaRates({ message: "Invalid API Key", data: [] })).toThrow(MyParcelError);
  });
});

describe("MyParcel Asia request", () => {
  it("posts the documented v3 body with the stored sender postcode", async () => {
    const created = await SELF.fetch(`${ORIGIN}/api/integrations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        provider: "myparcel-asia",
        name: "MPA Test",
        fields: {
          host: "app.myparcelasia.com",
          senderPostcode: "60000",
          apiKey: "mpa_test_key",
          apiSecret: "mpa_test_secret",
        },
      }),
    });
    expect(created.status).toBe(201);

    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const prices = await quoteRates(
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
    expect(prices.get("jnt")).toBe(720);
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
    expect(first.get("jnt")).toBe(720);

    const second = await quoteRates(
      env,
      { receiverPostcode: "50000", weightKg: 2 },
      {
        fetchImpl: async () => {
          throw new Error("cache miss");
        },
      },
    );
    expect(second.get("jnt")).toBe(720);
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
