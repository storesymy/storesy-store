import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { formatOrderNo } from "@storesy/shared";
import { GatewayError, billplzBase, createBill, getBill } from "../src/services/payments/billplz";
import { billplzCallback, completeReturn, start, thankYou } from "../src/services/payments.service";

/**
 * The money-moving half of the checkout: sending the buyer to Billplz with
 * the right email and the server's total, then believing the gateway ONLY
 * after re-reading the bill with the merchant's key.
 *
 * No test reaches the internet: the adapter takes a `fetch`, and the service
 * threads it through, so every request below is scripted and inspected.
 */

const ORIGIN = "http://example.com";
const CUSTOMER = {
  name: "Aina Rahman",
  phone: "0123456789",
  email: "aina@example.com",
};
const API_KEY = "test-secret-123";
const COLLECTION = "inbmmepb";

let session: Promise<string> | null = null;
function sharedSession(): Promise<string> {
  session ??= (async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Payments Tester",
        email: `payments-${crypto.randomUUID()}@example.com`,
        password: "correct horse battery",
      }),
    });
    expect(response.status).toBe(201);
    return (response.headers.get("set-cookie") as string).split(";")[0] as string;
  })();
  return session;
}

const jsonHeaders = (cookie: string) => ({ "Content-Type": "application/json", Cookie: cookie });

async function createProduct(cookie: string, name: string, price: number): Promise<string> {
  const created = await SELF.fetch(`${ORIGIN}/api/products`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ name, type: "digital" }),
  });
  expect(created.status).toBe(201);
  const product = (await created.json()) as { id: string };
  const patched = await SELF.fetch(`${ORIGIN}/api/products/${product.id}`, {
    method: "PATCH",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ name, type: "digital", price, fulfilment: { shipment: false, download: true } }),
  });
  expect(patched.status).toBe(200);
  return product.id;
}

async function createPage(cookie: string, slug: string, products: string[]): Promise<string> {
  const created = await SELF.fetch(`${ORIGIN}/api/salespages`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ name: "Payment Page", slug, products }),
  });
  expect(created.status).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

async function patchPage(cookie: string, id: string, body: Record<string, unknown>): Promise<void> {
  const patched = await SELF.fetch(`${ORIGIN}/api/salespages/${id}`, {
    method: "PATCH",
    headers: jsonHeaders(cookie),
    body: JSON.stringify(body),
  });
  expect(patched.status).toBe(200);
}

async function createIntegration(
  cookie: string,
  provider: string,
  slash: string,
  fields: Record<string, string>,
): Promise<string> {
  const created = await SELF.fetch(`${ORIGIN}/api/integrations`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ provider, name: `Payments ${slash}`, fields }),
  });
  expect(created.status).toBe(201);
  return ((await created.json()) as { uuid: string }).uuid;
}

interface PlacedOrder {
  id: string;
  status: string;
  totalCents: number;
}

async function priceOf(product: string): Promise<number> {
  const response = await SELF.fetch(`${ORIGIN}/api/products/${product}`, {
    headers: { Cookie: await sharedSession() },
  });
  const body = (await response.json()) as { price: number; discountPrice?: number | null };
  return body.discountPrice ?? body.price;
}

/** Place an order for one product at its current server price. */
async function placeOrder(slug: string, product: string, qty = 1): Promise<PlacedOrder> {
  const unit = await priceOf(product);
  const response = await SELF.fetch(`${ORIGIN}/api/public/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      slug,
      items: [{ product, qty }],
      customer: CUSTOMER,
      totalCents: unit * qty,
    }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { order: PlacedOrder }).order;
}

/** Scripted gateway: routes by URL, records every request for inspection. */
interface Recorded {
  url: string;
  method: string;
  authorization: string | null;
  body: string;
}

function scriptedFetch(routes: {
  bill?: Record<string, unknown>;
  state?: Record<string, unknown>;
  failWith?: Error;
}): { fetcher: typeof fetch; calls: Recorded[]; bills: Recorded[] } {
  const calls: Recorded[] = [];
  const bills: Recorded[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const record: Recorded = {
      url,
      method,
      authorization: headers.get("Authorization"),
      body: typeof init?.body === "string" ? init.body : "",
    };
    calls.push(record);
    if (url.endsWith("/api/v3/bills") && method === "POST") {
      bills.push(record);
      return new Response(JSON.stringify(routeBill()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (/\/api\/v3\/bills\/[^/]+$/.test(url)) {
      return new Response(JSON.stringify(routeState()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  }) as typeof fetch;

  function routeBill(): Record<string, unknown> {
    if (routes.failWith) throw routes.failWith;
    return routes.bill ?? { id: "bill_abc123", url: "https://www.billplz.com/bills/bill_abc123" };
  }
  function routeState(): Record<string, unknown> {
    if (routes.failWith) throw routes.failWith;
    return routes.state ?? { paid: false, amount: 0, paid_amount: 0, state: "due" };
  }
  return { fetcher, calls, bills };
}

async function orderRowData(uuid: string): Promise<{ id: number; status: string; data: string }> {
  const row = await env.DB.prepare("SELECT id, status, data FROM orders WHERE uuid = ?")
    .bind(uuid)
    .first<{ id: number; status: string; data: string }>();
  if (!row) throw new Error("order row missing");
  return row;
}

/** A page wired to a fresh Billplz integration, with one RM19.90 product. */
async function storeWithBillplz(slug: string): Promise<{ pageId: string; product: string; order: PlacedOrder }> {
  const cookie = await sharedSession();
  const product = await createProduct(cookie, "Payment Test Item", 1990);
  const pageId = await createPage(cookie, slug, [product]);
  const integration = await createIntegration(cookie, "billplz", slug, {
    host: "billplz-sandbox.com",
    apiKey: API_KEY,
    collectionId: COLLECTION,
  });
  await patchPage(cookie, pageId, { paymentGateway: integration });
  const order = await placeOrder(slug, product);
  return { pageId, product, order };
}

describe("billplz transport", () => {
  it("creates a bill with the buyer's email, the amount in cents and both return URLs", async () => {
    const { fetcher, bills } = scriptedFetch({});
    const created = await createBill(
      { host: "billplz-sandbox.com", apiKey: API_KEY, collectionId: COLLECTION },
      {
        amountCents: 1990,
        email: "aina@example.com",
        name: "Aina Rahman",
        description: "Payment Page — ord-123",
        reference: "ord-123",
        callbackUrl: "http://example.com/api/public/payments/billplz/callback/ord-123",
        redirectUrl: "http://example.com/pay-page/payment-return/ord-123",
      },
      fetcher,
    );

    expect(created).toEqual({
      id: "bill_abc123",
      url: "https://www.billplz.com/bills/bill_abc123",
    });
    const bill = bills[0];
    expect(bill?.url).toBe("https://www.billplz-sandbox.com/api/v3/bills");
    expect(bill?.authorization).toBe(`Basic ${btoa(`${API_KEY}:`)}`);
    const form = new URLSearchParams(bill?.body ?? "");
    expect(form.get("collection_id")).toBe(COLLECTION);
    expect(form.get("email")).toBe("aina@example.com");
    expect(form.get("amount")).toBe("1990");
    expect(form.get("reference_1")).toBe("ord-123");
    expect(form.get("callback_url")).toContain("/api/public/payments/billplz/callback/ord-123");
    expect(form.get("redirect_url")).toContain("/pay-page/payment-return/ord-123");
  });

  it("maps a rejected key to a readable error and never invents a link", async () => {
    const fetcher = (async () =>
      new Response("Unauthorized", { status: 401 })) as unknown as typeof fetch;
    await expect(
      createBill(
        { host: "billplz.com", apiKey: "bad", collectionId: "col" },
        {
          amountCents: 100,
          email: "a@b.co",
          name: "A",
          description: "d",
          reference: "r",
          callbackUrl: "http://example.com/cb",
          redirectUrl: "http://example.com/rd",
        },
        fetcher,
      ),
    ).rejects.toMatchObject({ status: 401, message: expect.stringContaining("credentials") });

    // A 200 without a bill is not a payment page either.
    const empty = (async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;
    await expect(
      createBill(
        { host: "billplz.com", apiKey: API_KEY, collectionId: "col" },
        {
          amountCents: 100,
          email: "a@b.co",
          name: "A",
          description: "d",
          reference: "r",
          callbackUrl: "http://example.com/cb",
          redirectUrl: "http://example.com/rd",
        },
        empty,
      ),
    ).rejects.toBeInstanceOf(GatewayError);
  });

  it("reads the bill state honestly, including the amount", async () => {
    const { fetcher, calls } = scriptedFetch({
      state: { paid: true, amount: 1990, paid_amount: 1990, state: "paid" },
    });
    const state = await getBill(
      { host: "billplz.com", apiKey: API_KEY, collectionId: COLLECTION },
      "bill_abc123",
      fetcher,
    );
    expect(state).toEqual({ paid: true, amountCents: 1990, paidAmountCents: 1990, state: "paid" });
    expect(calls[0]?.url).toBe("https://www.billplz.com/api/v3/bills/bill_abc123");
    expect(billplzBase("billplz-sandbox.com")).toBe("https://www.billplz-sandbox.com");
  });
});

describe("checkout origin", () => {
  it("accepts the page's own origin and refuses a foreign one", async () => {
    const cookie = await sharedSession();
    const product = await createProduct(cookie, "Origin Item", 800);
    await createPage(cookie, "pay-origin", [product]);
    const body = JSON.stringify({
      slug: "pay-origin",
      items: [{ product, qty: 1 }],
      customer: CUSTOMER,
      totalCents: 800,
    });
    const post = (origin: string) =>
      SELF.fetch(`${ORIGIN}/api/public/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body,
      });

    // The page at /pay-origin is served by this same host: its checkout POST
    // carries that origin, which is not necessarily the SPA's WEB_ORIGIN.
    expect((await post(ORIGIN)).status).toBe(201);
    const foreign = await post("https://evil.example");
    expect(foreign.status).toBe(403);
    expect(((await foreign.json()) as { error: { code: string } }).error.code).toBe("csrf_rejected");
  });
});

describe("starting a payment", () => {
  it("sends the buyer to Billplz for the order's exact email and total, once", async () => {
    const { order } = await storeWithBillplz("pay-start");
    const { fetcher, bills } = scriptedFetch({});

    const first = await start(env, order.id, ORIGIN, fetcher);
    expect(first.url).toBe("https://www.billplz.com/bills/bill_abc123");

    const form = new URLSearchParams(bills[0]?.body ?? "");
    expect(form.get("amount")).toBe("1990");
    expect(form.get("email")).toBe(CUSTOMER.email);
    expect(form.get("name")).toBe(CUSTOMER.name);
    expect(form.get("redirect_url")).toBe(`${ORIGIN}/pay-start/payment-return/${order.id}`);
    expect(form.get("callback_url")).toBe(
      `${ORIGIN}/api/public/payments/billplz/callback/${order.id}`,
    );

    // The bill reference is remembered, and a second call reuses it.
    const row = await orderRowData(order.id);
    const data = JSON.parse(row.data) as {
      payment?: { reference: string; provider: string; url: string };
    };
    expect(data.payment).toMatchObject({
      provider: "billplz",
      reference: "bill_abc123",
      url: "https://www.billplz.com/bills/bill_abc123",
    });
    const second = await start(env, order.id, ORIGIN, fetcher);
    expect(second.url).toBe(first.url);
    expect(bills).toHaveLength(1); // no duplicate bill for a double click
  });

  it("refuses pages with no gateway, and gateways it can't drive yet", async () => {
    const cookie = await sharedSession();
    const product = await createProduct(cookie, "No Gateway Item", 1200);
    const pageId = await createPage(cookie, "pay-none", [product]);
    const order = await placeOrder("pay-none", product);
    const { fetcher, calls } = scriptedFetch({});

    await expect(start(env, order.id, ORIGIN, fetcher)).rejects.toMatchObject({
      status: 409,
      code: "payment_unavailable",
    });

    // CHIP is a Payment integration but the flow can't drive it yet.
    const chip = await createIntegration(cookie, "chip", "pay-none", { secretKey: "sk_test_123" });
    await patchPage(cookie, pageId, { paymentGateway: chip });
    await expect(start(env, order.id, ORIGIN, fetcher)).rejects.toMatchObject({
      status: 409,
      code: "payment_unavailable",
    });
    expect(calls).toHaveLength(0); // nothing was sent anywhere
    expect((await orderRowData(order.id)).status).toBe("pending");
  });

  it("keeps the order pending when the gateway won't take the bill", async () => {
    const { order } = await storeWithBillplz("pay-gateway-down");
    const { fetcher } = scriptedFetch({ failWith: new Error("network down") });
    await expect(start(env, order.id, ORIGIN, fetcher)).rejects.toMatchObject({
      status: 409,
      code: "gateway_error",
    });
    expect((await orderRowData(order.id)).status).toBe("pending");
  });
});

describe("admin test checkout", () => {
  async function simulate(cookie: string, orderId: string, outcome: string): Promise<Response> {
    return SELF.fetch(`${ORIGIN}/api/orders/${orderId}/test`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ outcome }),
    });
  }

  it("simulates success, failure and cancel — and marks the order test", async () => {
    const cookie = await sharedSession();
    const product = await createProduct(cookie, "Test Checkout Item", 2500);
    await createPage(cookie, "test-admin", [product]);

    const paidOrder = await placeOrder("test-admin", product);
    const paid = await simulate(cookie, paidOrder.id, "success");
    expect(paid.status).toBe(200);
    expect(((await paid.json()) as { url: string }).url).toBe(
      `/test-admin/thank-you/${paidOrder.id}`,
    );
    const paidRow = JSON.parse((await orderRowData(paidOrder.id)).data) as { test?: boolean };
    expect((await orderRowData(paidOrder.id)).status).toBe("paid");
    expect(paidRow.test).toBe(true);
    // The receipt says it was a test — no money moved.
    const receipt = await SELF.fetch(`${ORIGIN}/test-admin/thank-you/${paidOrder.id}`);
    expect(receipt.status).toBe(200);
    expect(await receipt.text()).toContain("TEST ORDER");

    const failedOrder = await placeOrder("test-admin", product);
    const failed = await simulate(cookie, failedOrder.id, "failed");
    expect(failed.status).toBe(200);
    expect(((await failed.json()) as { url: string }).url).toBe("/test-admin?payment=failed");
    expect((await orderRowData(failedOrder.id)).status).toBe("failed");

    const cancelledOrder = await placeOrder("test-admin", product);
    const cancelled = await simulate(cookie, cancelledOrder.id, "cancel");
    expect(cancelled.status).toBe(200);
    expect(((await cancelled.json()) as { url: string }).url).toBe(
      "/test-admin?payment=cancelled",
    );
    expect((await orderRowData(cancelledOrder.id)).status).toBe("cancelled");

    // The merchant list carries the flag for the UI badge.
    const list = await SELF.fetch(`${ORIGIN}/api/orders`, { headers: { Cookie: cookie } });
    const orders = ((await list.json()) as { orders: { id: string; test: boolean }[] }).orders;
    for (const id of [paidOrder.id, failedOrder.id, cancelledOrder.id]) {
      expect(orders.find((order) => order.id === id)?.test).toBe(true);
    }

    await SELF.fetch(`${ORIGIN}/api/salespages/${(await (await SELF.fetch(`${ORIGIN}/api/salespages`, { headers: { Cookie: cookie } })).json() as { salesPages: { id: string; slug: string }[] }).salesPages.find((page) => page.slug === "test-admin")!.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
  });

  it("is admin-only: 401 signed out, 403 for a non-admin", async () => {
    const cookie = await sharedSession();
    const product = await createProduct(cookie, "Admin Gate Item", 900);
    await createPage(cookie, "test-gate", [product]);
    const order = await placeOrder("test-gate", product);

    const anon = await SELF.fetch(`${ORIGIN}/api/orders/${order.id}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: "success" }),
    });
    expect(anon.status).toBe(401);

    // A second account, demoted to a non-admin role, can't conjure a paid order.
    const email = `viewer-${crypto.randomUUID()}@example.com`;
    const signup = await SELF.fetch(`${ORIGIN}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Viewer", email, password: "correct horse battery" }),
    });
    expect(signup.status).toBe(201);
    const viewerCookie = (signup.headers.get("set-cookie") as string).split(";")[0] as string;
    await env.DB.prepare("UPDATE users SET role = 'viewer' WHERE email = ?").bind(email).run();

    const denied = await simulate(viewerCookie, order.id, "success");
    expect(denied.status).toBe(403);
    expect(((await orderRowData(order.id)).status)).toBe("pending");

    await SELF.fetch(`${ORIGIN}/api/salespages/${(await (await SELF.fetch(`${ORIGIN}/api/salespages`, { headers: { Cookie: cookie } })).json() as { salesPages: { id: string; slug: string }[] }).salesPages.find((page) => page.slug === "test-gate")!.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
  });

  it("refuses to rewrite a paid order and 404s an unknown one", async () => {
    const cookie = await sharedSession();
    const product = await createProduct(cookie, "No Rewrite Item", 700);
    await createPage(cookie, "test-norewrite", [product]);
    const order = await placeOrder("test-norewrite", product);

    expect((await simulate(cookie, order.id, "success")).status).toBe(200);
    const again = await simulate(cookie, order.id, "cancel");
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe(
      "order_already_paid",
    );

    const unknown = await simulate(cookie, "ord-0199f3c2-0000-7000-8000-000000000000", "success");
    expect(unknown.status).toBe(404);
  });
});

describe("returning from the gateway", () => {
  it("confirms a paid bill, marks the order paid and shows the receipt", async () => {
    const { order } = await storeWithBillplz("pay-return");
    await start(env, order.id, ORIGIN, scriptedFetch({}).fetcher);

    const { fetcher } = scriptedFetch({
      state: { paid: true, amount: 1990, paid_amount: 1990, state: "paid" },
    });
    const location = await completeReturn(env, order.id, fetcher);
    expect(location).toBe(`/pay-return/thank-you/${order.id}`);
    expect((await orderRowData(order.id)).status).toBe("paid");

    const page = await SELF.fetch(`${ORIGIN}/pay-return/thank-you/${order.id}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Payment received");
    expect(html).toContain("RM19.90");
    // The receipt's reference is the human order number, never the UUID.
    expect(html).toContain(formatOrderNo((await orderRowData(order.id)).id));
    expect(html).not.toContain(order.id);
    expect(html).toContain(CUSTOMER.email);

    // A replay (gateway retry, reload) changes nothing and stays on the receipt.
    const locationAgain = await completeReturn(env, order.id, fetcher);
    expect(locationAgain).toBe(location);
  });

  it("does not mark a bill paid for a different amount", async () => {
    const { order } = await storeWithBillplz("pay-short");
    await start(env, order.id, ORIGIN, scriptedFetch({}).fetcher);

    const { fetcher } = scriptedFetch({
      state: { paid: true, amount: 100, paid_amount: 100, state: "paid" },
    });
    const location = await completeReturn(env, order.id, fetcher);
    expect(location).toBe("/pay-short?payment=failed");
    expect((await orderRowData(order.id)).status).toBe("pending");
  });

  it("returns to the page with failed, or pending when it couldn't ask", async () => {
    const { order } = await storeWithBillplz("pay-unpaid");
    await start(env, order.id, ORIGIN, scriptedFetch({}).fetcher);

    const unpaid = scriptedFetch({
      state: { paid: false, amount: 1990, paid_amount: 0, state: "due" },
    });
    expect(await completeReturn(env, order.id, unpaid.fetcher)).toBe("/pay-unpaid?payment=failed");

    // Gateway unreachable on the way back: never call an order failed.
    const down = scriptedFetch({ failWith: new Error("timeout") });
    expect(await completeReturn(env, order.id, down.fetcher)).toBe("/pay-unpaid?payment=pending");
    expect((await orderRowData(order.id)).status).toBe("pending");
  });

  it("treats the callback as a hint and verifies before flipping the order", async () => {
    const { order } = await storeWithBillplz("pay-callback");
    await start(env, order.id, ORIGIN, scriptedFetch({}).fetcher);

    // Unpaid callback changes nothing.
    await billplzCallback(env, order.id, scriptedFetch({}).fetcher);
    expect((await orderRowData(order.id)).status).toBe("pending");

    const paid = scriptedFetch({
      state: { paid: true, amount: 1990, paid_amount: 1990, state: "paid" },
    });
    await billplzCallback(env, order.id, paid.fetcher);
    expect((await orderRowData(order.id)).status).toBe("paid");
  });

  it("refuses a receipt for an unpaid order", async () => {
    const { order } = await storeWithBillplz("pay-unpaid-receipt");
    expect(await thankYou(env, order.id)).toEqual({ redirect: "/pay-unpaid-receipt?payment=pending" });
    const response = await SELF.fetch(`${ORIGIN}/pay-unpaid-receipt/thank-you/${order.id}`, {
      redirect: "manual",
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/pay-unpaid-receipt?payment=pending");
  });

  it("answers unknown orders with a 404 document, not JSON", async () => {
    const response = await SELF.fetch(
      `${ORIGIN}/pay-return/payment-return/ord-0199f3c2-0000-7000-8000-000000000000`,
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("text/html");
  });
});
