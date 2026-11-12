import { DEFAULT_EMAIL_TEMPLATES } from "@storesy/shared";
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { OrderData } from "../src/models/schema";
import * as emailTemplates from "../src/services/emailTemplates.service";
import { buildAdminEmail, buildCustomerEmail, notifyOrderPaid } from "../src/services/notifications.service";

/**
 * Payment notifications: the buyer's thank-you (items, total, downloads) and
 * the merchant's new-checkout email, both through the page's Email
 * integration. The transport is injected here, so no mail leaves the test.
 */

const ORIGIN = "http://example.com";
const CUSTOMER = { name: "Aina Rahman", phone: "0123456789", email: "aina@example.com" };

let session: Promise<string> | null = null;
function sharedSession(): Promise<string> {
  session ??= (async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Notify Tester",
        email: `notify-${crypto.randomUUID()}@example.com`,
        password: "correct horse battery",
      }),
    });
    expect(response.status).toBe(201);
    return (response.headers.get("set-cookie") as string).split(";")[0] as string;
  })();
  return session;
}

const jsonHeaders = (cookie: string) => ({ "Content-Type": "application/json", Cookie: cookie });

async function createDigitalProduct(cookie: string, name: string, price: number): Promise<string> {
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
    body: JSON.stringify({
      name,
      type: "digital",
      price,
      fulfilment: { shipment: false, download: true },
      downloadLinks: ["https://example.com/guide.pdf"],
    }),
  });
  expect(patched.status).toBe(200);
  return product.id;
}

async function createPage(cookie: string, slug: string, products: string[]): Promise<string> {
  const created = await SELF.fetch(`${ORIGIN}/api/salespages`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ name: "Notify Page", slug, products }),
  });
  expect(created.status).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

async function patchPage(cookie: string, id: string, body: Record<string, unknown>): Promise<void> {
  const response = await SELF.fetch(`${ORIGIN}/api/salespages/${id}`, {
    method: "PATCH",
    headers: jsonHeaders(cookie),
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
}

/**
 * Gmail is connected with Google OAuth now, so the generic credential API
 * refuses it. These tests only need a row to exist — the transport itself is
 * always injected (`notifyOrderPaid(..., { send })`), so seed one directly.
 */
async function createEmailIntegration(_cookie: string): Promise<string> {
  const uuid = `itg-${crypto.randomUUID()}`;
  await env.DB.prepare(
    "INSERT INTO integrations (uuid, name, provider, data) VALUES (?, ?, ?, ?)",
  )
    .bind(
      uuid,
      "Notify Sender",
      "gmail",
      JSON.stringify({
        connected: true,
        connectedAt: "2026-11-01 10:00:00",
        settings: { username: "store@gmail.com", auth: "oauth" },
        secrets: { refreshToken: "v1.dummy.dummy" },
        hints: {},
        createdAt: "2026-11-01 10:00:00",
        updatedAt: "2026-11-01 10:00:00",
      }),
    )
    .run();
  return uuid;
}

async function placeOrder(slug: string, product: string, price: number): Promise<{ id: string; status: string }> {
  const response = await SELF.fetch(`${ORIGIN}/api/public/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      slug,
      items: [{ product, qty: 1 }],
      customer: CUSTOMER,
      totalCents: price,
    }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { order: { id: string; status: string } }).order;
}

/**
 * Mark an order paid directly. The API's simulate endpoint also fires the
 * real notification (admin-gated test checkout), which would race the
 * injected sender below — notification unit tests own the trigger instead.
 */
async function markPaid(orderId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE orders SET status = 'paid', data = json_set(data, '$.payment.paidAt', datetime('now','localtime')) WHERE uuid = ?",
  )
    .bind(orderId)
    .run();
}

async function orderData(orderId: string): Promise<{ status: string; data: OrderData }> {
  const row = await env.DB.prepare("SELECT status, data FROM orders WHERE uuid = ?")
    .bind(orderId)
    .first<{ status: string; data: string }>();
  if (!row) throw new Error("order row missing");
  return { status: row.status, data: JSON.parse(row.data) as OrderData };
}

/** A paid order on a page wired to a Gmail integration. */
async function paidOrderOnWiredPage(slug: string): Promise<{ orderId: string; product: string; pageId: string }> {
  const cookie = await sharedSession();
  const product = await createDigitalProduct(cookie, "Notify Ebook", 3000);
  const pageId = await createPage(cookie, slug, [product]);
  const sender = await createEmailIntegration(cookie);
  await patchPage(cookie, pageId, { emailSender: sender });
  const order = await placeOrder(slug, product, 3000);
  await markPaid(order.id);
  return { orderId: order.id, product, pageId };
}

const SAMPLE_CUSTOMER = {
  name: "Aina Rahman",
  phone: "0123456789",
  email: "aina@example.com",
  address: "12 Jalan Merdeka",
  postcode: "50000",
  city: "Kuala Lumpur",
  state: "Selangor",
};

const SAMPLE_ORDER: OrderData = {
  items: [{ product: "prd-01a1a1a1-0000-7000-8000-000000000001", name: "Notify Ebook", unitCents: 3000, qty: 2 }],
  subtotalCents: 6000,
  shippingCents: 0,
  totalCents: 6000,
  createdAt: "2026-11-04 10:00:00",
  updatedAt: "2026-11-04 10:00:00",
  payment: {
    provider: "billplz",
    integration: "itg-x",
    reference: "bill_1",
    url: "https://www.billplz.com/bills/bill_1",
    createdAt: "2026-11-04 10:01:00",
    paidAt: "2026-11-04 10:05:00",
  },
};

describe("notification content", () => {
  it("thanks the buyer with the items, the total and the downloads", () => {
    const message = buildCustomerEmail(SAMPLE_ORDER, SAMPLE_CUSTOMER, "Nota Bisnes", "#0001", [
      { name: "Notify Ebook", urls: ["https://example.com/guide.pdf"] },
    ]);
    expect(message.subject).toBe("Thank you for your order — Nota Bisnes");
    expect(message.text).toContain("Hi Aina,");
    expect(message.text).toContain("Thank you for shopping with Nota Bisnes");
    expect(message.text).toContain("your payment of RM60.00 has been received");
    expect(message.text).toContain("- Notify Ebook × 2 — RM60.00");
    expect(message.text).toContain("Total paid: RM60.00 (2 items)");
    expect(message.text).toContain("Downloads");
    expect(message.text).toContain("https://example.com/guide.pdf");
    expect(message.text).toContain("Order: #0001");
    expect(message.text).not.toContain("[TEST]");
    // Every placeholder resolved — a buyer never sees `{firstName}`.
    expect(message.text).not.toMatch(/\{[a-zA-Z][a-zA-Z0-9]*\}/);
  });

  it("adds the delivery sentence for a shipped order and no empty Downloads heading", () => {
    const physical: OrderData = { ...SAMPLE_ORDER, shippingCents: 500, totalCents: 6500 };
    const message = buildCustomerEmail(physical, SAMPLE_CUSTOMER, "Nota Bisnes", "#0002", []);
    expect(message.text).toContain("We'll be in touch at aina@example.com about delivery.");
    expect(message.text).not.toContain("Downloads");
    expect(message.text).not.toMatch(/\{[a-zA-Z][a-zA-Z0-9]*\}/);
  });

  it("tells the admin who bought what, for how much and how many", () => {
    const message = buildAdminEmail(SAMPLE_ORDER, SAMPLE_CUSTOMER, "Nota Bisnes", "#0001", "nota-bisnes");
    expect(message.subject).toBe("New checkout — RM60.00 — #0001");
    expect(message.text).toContain("New checkout on Nota Bisnes (/nota-bisnes)");
    expect(message.text).toContain("Name: Aina Rahman");
    expect(message.text).toContain("Email: aina@example.com");
    expect(message.text).toContain("Phone: 0123456789");
    expect(message.text).toContain("Address: 12 Jalan Merdeka, 50000, Kuala Lumpur, Selangor");
    expect(message.text).toContain("- Notify Ebook × 2 — RM60.00");
    expect(message.text).toContain("Total: RM60.00");
    expect(message.text).toContain("Quantity: 2 units in 1 line");
    expect(message.text).toContain("Order: #0001");
  });

  it("marks test orders in both subjects and bodies", () => {
    const testOrder: OrderData = { ...SAMPLE_ORDER, test: true };
    expect(buildCustomerEmail(testOrder, SAMPLE_CUSTOMER, "Shop", "#0009", []).subject).toMatch(/^\[TEST\] /);
    expect(buildCustomerEmail(testOrder, SAMPLE_CUSTOMER, "Shop", "#0009", []).text).toContain("no payment was taken");
    expect(buildAdminEmail(testOrder, SAMPLE_CUSTOMER, "Shop", "#0009", "shop").subject).toMatch(/^\[TEST\] /);
    expect(buildAdminEmail(testOrder, SAMPLE_CUSTOMER, "Shop", "#0009", "shop").text).toContain("Test order");
  });
});

describe("notifyOrderPaid", () => {
  it("sends the buyer and the primary admin exactly once", async () => {
    const { orderId } = await paidOrderOnWiredPage("notify-send");
    // Every account in the test DB is on example.com, so the deliverable-admin
    // lookup yields none and the notification falls back to the sender address.
    const sent: { to: string; subject: string; text: string }[] = [];
    const fake = async (
      _env: Env,
      _row: unknown,
      message: { to: string; subject: string; text: string },
    ) => {
      sent.push(message);
      return { from: "store@gmail.com" };
    };

    await notifyOrderPaid(env, orderId, ORIGIN, { send: fake as never });
    expect(sent).toHaveLength(2);

    const buyer = sent.find((message) => message.to === CUSTOMER.email);
    expect(buyer?.subject).toBe("Thank you for your order — Notify Page");
    expect(buyer?.text).toContain("- Notify Ebook × 1 — RM30.00");
    expect(buyer?.text).toContain("Total paid: RM30.00");
    expect(buyer?.text).toContain("https://example.com/guide.pdf");

    const merchant = sent.find((message) => message.to === "store@gmail.com");
    expect(merchant).toBeDefined();
    expect(merchant?.text).toContain(`Name: ${CUSTOMER.name}`);
    expect(merchant?.text).toContain("Total: RM30.00");
    expect(merchant?.text).toContain("Quantity: 1 unit in 1 line");
    expect(merchant?.text).toContain("Status: paid");

    const saved = await orderData(orderId);
    expect(saved.data.notified?.customer).toBeTruthy();
    expect(saved.data.notified?.admin).toBeTruthy();

    // A duplicate trigger (gateway callback racing the browser return) sends
    // nothing — the markers are the guard.
    await notifyOrderPaid(env, orderId, ORIGIN, { send: fake as never });
    expect(sent).toHaveLength(2);
  });

  it("sends nothing for an unpaid order", async () => {
    const cookie = await sharedSession();
    const product = await createDigitalProduct(cookie, "Unpaid Ebook", 1500);
    const pageId = await createPage(cookie, "notify-unpaid", [product]);
    const sender = await createEmailIntegration(cookie);
    await patchPage(cookie, pageId, { emailSender: sender });
    const order = await placeOrder("notify-unpaid", product, 1500);

    const sent: unknown[] = [];
    await notifyOrderPaid(env, order.id, ORIGIN, {
      send: (async () => {
        sent.push(1);
        return { from: "x" };
      }) as never,
    });
    expect(sent).toHaveLength(0);
  });

  it("keeps the other email going when one send fails", async () => {
    const { orderId } = await paidOrderOnWiredPage("notify-partial");
    let attempts = 0;
    const sentTo: string[] = [];
    const fake = async (_env: Env, _row: unknown, message: { to: string }) => {
      attempts += 1;
      if (message.to === CUSTOMER.email) throw new Error("smtp down");
      sentTo.push(message.to);
      return { from: "store@gmail.com" };
    };

    await notifyOrderPaid(env, orderId, ORIGIN, { send: fake as never });
    expect(attempts).toBe(2);
    expect(sentTo).toHaveLength(1); // the admin still heard about the sale
    const saved = await orderData(orderId);
    expect(saved.data.notified?.customer).toBeUndefined();
    expect(saved.data.notified?.admin).toBeTruthy();
  });
});

describe("download links", () => {
  it("serves a paid order's own file, signed out, with the R2 link in the email", async () => {
    const cookie = await sharedSession();
    const product = await createDigitalProduct(cookie, "File Ebook", 2000);

    // Upload real bytes, then record them on the product.
    const bytes = new TextEncoder().encode("ebook contents");
    const upload = await SELF.fetch(`${ORIGIN}/api/files?product=${product}`, {
      method: "POST",
      headers: { Cookie: cookie, "x-file-name": "guide.pdf" },
      body: bytes,
    });
    expect(upload.status).toBe(201);
    const file = (await upload.json()) as { path: string; name: string; size: number };
    const patched = await SELF.fetch(`${ORIGIN}/api/products/${product}`, {
      method: "PATCH",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ downloadFiles: [file] }),
    });
    expect(patched.status).toBe(200);

    const pageId = await createPage(cookie, "download-paid", [product]);
    const sender = await createEmailIntegration(cookie);
    await patchPage(cookie, pageId, { emailSender: sender });
    const order = await placeOrder("download-paid", product, 2000);
    await markPaid(order.id);

    // The email carries the private download URL for the R2 file.
    const sent: { to: string; text: string }[] = [];
    await notifyOrderPaid(env, order.id, ORIGIN, {
      send: (async (_env: Env, _row: unknown, message: { to: string; text: string }) => {
        sent.push(message);
        return { from: "x" };
      }) as never,
    });
    const buyer = sent.find((message) => message.to === CUSTOMER.email);
    expect(buyer?.text).toContain(`${ORIGIN}/api/public/downloads/${order.id}/${product}/0`);

    // Signed out, no cookie: the order id is the capability.
    const download = await SELF.fetch(
      `${ORIGIN}/api/public/downloads/${order.id}/${product}/0`,
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("Content-Disposition")).toContain('filename="guide.pdf"');
    expect(await download.text()).toBe("ebook contents");

    // Unpaid order, a product it doesn't contain, and a bad index all 404.
    const unpaid = await placeOrder("download-paid", product, 2000);
    expect(
      (await SELF.fetch(`${ORIGIN}/api/public/downloads/${unpaid.id}/${product}/0`)).status,
    ).toBe(404);
    expect(
      (
        await SELF.fetch(
          `${ORIGIN}/api/public/downloads/${order.id}/prd-01a1a1a1-0000-7000-8000-000000000009/0`,
        )
      ).status,
    ).toBe(404);
    expect(
      (await SELF.fetch(`${ORIGIN}/api/public/downloads/${order.id}/${product}/3`)).status,
    ).toBe(404);
  });
});

describe("edited templates", () => {
  it("sends the merchant's saved thank-you subject and message", async () => {
    const { orderId } = await paidOrderOnWiredPage("notify-template");

    // Seed the built-in row, then edit it the same way the dialog does.
    const [template] = await emailTemplates.list(env);
    if (!template) throw new Error("template row missing");
    await emailTemplates.update(env, template.id, {
      subject: "Your {pageName} order {orderNo}",
      body: "Hi {firstName},\n\nThanks for {total}.\n\n{items}\n\n{downloads}",
    });

    try {
      const sent: { to: string; subject: string; text: string }[] = [];
      await notifyOrderPaid(env, orderId, ORIGIN, {
        send: (async (_env: Env, _row: unknown, message: { to: string; subject: string; text: string }) => {
          sent.push(message);
          return { from: "x" };
        }) as never,
      });
      const buyer = sent.find((message) => message.to === CUSTOMER.email);
      expect(buyer?.subject).toMatch(/^Your Notify Page order #[0-9]{4,}$/);
      expect(buyer?.text).toContain("Hi Aina,");
      expect(buyer?.text).toContain("Thanks for RM30.00.");
      expect(buyer?.text).toContain("- Notify Ebook × 1 — RM30.00");
      expect(buyer?.text).toContain("https://example.com/guide.pdf");
      // The admin message is not the buyer's template.
      const merchant = sent.find((message) => message.to === "store@gmail.com");
      expect(merchant?.subject).toMatch(/^New checkout — RM30.00 — #/);
    } finally {
      const definition = DEFAULT_EMAIL_TEMPLATES[0];
      if (definition) {
        await emailTemplates.update(env, template.id, {
          subject: definition.subject,
          body: definition.body,
        });
      }
    }
  });
});
