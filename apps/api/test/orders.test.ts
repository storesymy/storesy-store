import { env, SELF } from "cloudflare:test";
import { formatCustomerNo } from "@storesy/shared";
import { describe, expect, it } from "vitest";

/**
 * The public checkout (`POST /api/public/orders`) is the app's only signed-out
 * write, and the only place a buyer's money is counted — so every price,
 * shipping line and total is the SERVER's arithmetic, never the form's. These
 * tests pin that contract: the snapshot written to D1, the page's checkout
 * list as the allowlist, the 409 when the client's total disagrees, the 404
 * for pages that aren't selling, and the per-IP rate limit that keeps the
 * open endpoint from becoming a row factory.
 */

const ORIGIN = "http://example.com";

/**
 * One account for the whole file: signups are rate-limited per client IP and
 * every test in the pool shares one, so the file signs up exactly once.
 */
let session: Promise<string> | null = null;
function sharedSession(): Promise<string> {
  session ??= (async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Orders Tester",
        email: `orders-${crypto.randomUUID()}@example.com`,
        password: "correct horse battery",
      }),
    });
    expect(response.status).toBe(201);
    return (response.headers.get("set-cookie") as string).split(";")[0] as string;
  })();
  return session;
}

const jsonHeaders = (cookie: string) => ({ "Content-Type": "application/json", Cookie: cookie });

interface ProductStub {
  id: string;
  name: string;
}

/** A product the way the studio creates it, then priced/typed by a PATCH. */
async function createProduct(
  cookie: string,
  name: string,
  patch: Record<string, unknown> = {},
): Promise<ProductStub> {
  const created = await SELF.fetch(`${ORIGIN}/api/products`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ name, type: "physical" }),
  });
  expect(created.status).toBe(201);
  const product = (await created.json()) as ProductStub;
  const updated = await SELF.fetch(`${ORIGIN}/api/products/${product.id}`, {
    method: "PATCH",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ name, type: "physical", ...patch }),
  });
  expect(updated.status).toBe(200);
  return product;
}

interface PageStub {
  id: string;
  slug: string;
  status: string;
}

async function createPage(
  cookie: string,
  slug: string,
  products: string[],
): Promise<PageStub> {
  const response = await SELF.fetch(`${ORIGIN}/api/salespages`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ name: "Checkout Page", slug, products }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as PageStub;
}

/** The checkout block's submit — signed out, like the page it sits on. */
async function submitOrder(body: unknown): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/public/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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

/** Direct row read — the snapshot is the receipt, so it is read back raw. */
async function orderRow(
  uuid: string,
): Promise<{ id: number; customerId: number | null; data: string; status: string } | null> {
  return env.DB.prepare("SELECT id, customer_id AS customerId, data, status FROM orders WHERE uuid = ?")
    .bind(uuid)
    .first<{ id: number; customerId: number | null; data: string; status: string }>();
}

async function customerRow(id: number): Promise<{
  email: string;
  name: string;
  phone: string;
  address: string | null;
  contacts: number;
} | null> {
  const row = await env.DB.prepare(
    `SELECT c.email, c.name,
            (SELECT COUNT(*) FROM customer_contact cc WHERE cc.customer_id = c.id AND cc.deleted_at IS NULL) AS contacts,
            (SELECT cc.phone FROM customer_contact cc WHERE cc.customer_id = c.id AND cc.deleted_at IS NULL ORDER BY cc.id DESC LIMIT 1) AS phone,
            (SELECT cc.data FROM customer_contact cc WHERE cc.customer_id = c.id AND cc.deleted_at IS NULL ORDER BY cc.id DESC LIMIT 1) AS contactData
     FROM customers c WHERE c.id = ?`,
  )
    .bind(id)
    .first<{ email: string; name: string; contacts: number; phone: string | null; contactData: string | null }>();
  if (!row) return null;
  const data = JSON.parse(row.contactData ?? "{}") as { address?: string | null };
  return {
    email: row.email,
    name: row.name,
    phone: row.phone ?? "",
    address: data.address ?? null,
    contacts: row.contacts,
  };
}

async function orderCount(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM orders").first<{ n: number }>();
  return row?.n ?? 0;
}

describe("public order checkout", () => {
  it("captures an order with server-computed totals and a full snapshot", async () => {
    const cookie = await sharedSession();
    // RM19.90 physical product (ships → the flat RM10 applies)…
    const tshirt = await createProduct(cookie, "Classic Tee", { price: 1990 });
    // …and a digital item on sale: RM30.00 marked down to RM24.00.
    const preset = await createProduct(cookie, "Photo Preset Pack", {
      type: "digital",
      price: 3000,
      discountPrice: 2400,
      fulfilment: { shipment: false, download: true },
    });
    await createPage(cookie, "checkout-happy", [tshirt.id, preset.id]);

    const response = await submitOrder({
      slug: "checkout-happy",
      items: [
        { product: tshirt.id, qty: 2 },
        { product: preset.id, qty: 1 },
      ],
      customer: CUSTOMER,
      // The client's arithmetic: 1990×2 + 2400 + 1000 shipping.
      totalCents: 7380,
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      order: {
        id: string;
        orderNo: string;
        status: string;
        items: { product: string; name: string; unitCents: number; qty: number }[];
        subtotalCents: number;
        shippingCents: number;
        totalCents: number;
        page: { name: string; slug: string };
      };
    };
    const order = body.order;
    expect(order.id).toMatch(
      /^ord-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(order.status).toBe("pending");
    // The human reference is #<row id>, zero-padded to four digits.
    expect(order.orderNo).toMatch(/^#\d{4,}$/);
    expect(order.orderNo).toBe(`#${String((await orderRow(order.id))?.id).padStart(4, "0")}`);
    // The discounted unit, not the list price — the server's own numbers.
    expect(order.items).toEqual([
      { product: tshirt.id, name: "Classic Tee", unitCents: 1990, qty: 2, image: null },
      { product: preset.id, name: "Photo Preset Pack", unitCents: 2400, qty: 1, image: null },
    ]);
    expect(order.subtotalCents).toBe(6380);
    expect(order.shippingCents).toBe(1000); // one physical line → flat shipping
    expect(order.totalCents).toBe(6380 + 1000);
    expect(order.page.slug).toBe("checkout-happy");

    // The order points at a customer row; the buyer details live there now.
    const row = await orderRow(order.id);
    expect(row?.status).toBe("pending");
    expect(row?.customerId).not.toBeNull();
    const customer = await customerRow(row?.customerId as number);
    expect(customer?.name).toBe("Aina Rahman");
    expect(customer?.email).toBe("aina@example.com");
    expect(customer?.phone).toBe("0123456789");
    expect(customer?.address).toBe("12 Jalan Merdeka");

    // The order blob no longer duplicates the buyer.
    const data = JSON.parse(row?.data ?? "{}") as { customer?: unknown; totalCents: number };
    expect(data.customer).toBeUndefined();
    expect(data.totalCents).toBe(7380);
  });

  it("deduplicates buyers by email and refreshes their details", async () => {
    const cookie = await sharedSession();
    const shirt = await createProduct(cookie, "Repeat Tee", {
      price: 2000,
      type: "digital",
      fulfilment: { shipment: false, download: true },
    });
    await createPage(cookie, "checkout-repeat", [shirt.id]);

    // A unique email isolates this test from customers earlier in the file.
    const email = `repeat-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const first = await submitOrder({
      slug: "checkout-repeat",
      items: [{ product: shirt.id, qty: 1 }],
      customer: { name: "Aina Rahman", phone: "0123456789", email: email.toUpperCase() },
      totalCents: 2000,
    });
    expect(first.status).toBe(201);
    const firstOrder = ((await first.json()) as { order: { id: string } }).order;

    // Same person, different case + a new phone: one customer row, refreshed.
    const second = await submitOrder({
      slug: "checkout-repeat",
      items: [{ product: shirt.id, qty: 1 }],
      customer: { name: "Aina R.", phone: "0198887777", email },
      totalCents: 2000,
    });
    expect(second.status).toBe(201);
    const secondOrder = ((await second.json()) as { order: { id: string } }).order;

    const firstRow = await orderRow(firstOrder.id);
    const secondRow = await orderRow(secondOrder.id);
    expect(firstRow?.customerId).toBe(secondRow?.customerId);
    const stored = await customerRow(firstRow?.customerId as number);
    expect(stored?.email).toBe(email); // normalised (lowercase)
    expect(stored?.name).toBe("Aina R."); // customer-level name refreshes
    expect(stored?.contacts).toBe(2); // a changed detail set is a new contact
    expect(stored?.phone).toBe("0198887777"); // the latest contact

    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM customers WHERE email = ?")
      .bind(email)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("charges no shipping for a digital-only cart", async () => {
    const cookie = await sharedSession();
    const ebook = await createProduct(cookie, "Launch Checklist PDF", {
      type: "digital",
      price: 1500,
      fulfilment: { shipment: false, download: true },
    });
    await createPage(cookie, "checkout-digital", [ebook.id]);

    // No address block either — digital goods ship nowhere.
    const response = await submitOrder({
      slug: "checkout-digital",
      items: [{ product: ebook.id, qty: 1 }],
      customer: { name: "Aina Rahman", phone: "0123456789", email: "aina@example.com" },
      totalCents: 1500,
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { order: { shippingCents: number; totalCents: number } };
    expect(body.order.shippingCents).toBe(0);
    expect(body.order.totalCents).toBe(1500);
  });

  it("409s when the client's total disagrees with the server's", async () => {
    const cookie = await sharedSession();
    const mug = await createProduct(cookie, "Ceramic Mug", { price: 4500 });
    await createPage(cookie, "checkout-tampered", [mug.id]);
    const before = await orderCount();

    // The buyer's page claims a discount the catalogue never ran.
    const response = await submitOrder({
      slug: "checkout-tampered",
      items: [{ product: mug.id, qty: 1 }],
      customer: CUSTOMER,
      totalCents: 100,
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("price_changed");
    // Nothing was stored — a disagreement is never half-captured.
    expect(await orderCount()).toBe(before);
  });

  it("requires a delivery address when anything ships", async () => {
    const cookie = await sharedSession();
    const hoodie = await createProduct(cookie, "Heavy Hoodie", { price: 8900 });
    await createPage(cookie, "checkout-no-address", [hoodie.id]);

    const response = await submitOrder({
      slug: "checkout-no-address",
      items: [{ product: hoodie.id, qty: 1 }],
      customer: { name: "Aina Rahman", phone: "0123456789", email: "aina@example.com" },
      totalCents: 9900,
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { fields?: Record<string, string> } };
    expect(body.error.fields?.address).toContain("delivery address");
  });

  it("refuses products that aren't on the page's checkout list", async () => {
    const cookie = await sharedSession();
    const sold = await createProduct(cookie, "On The Page", { price: 1000 });
    const elsewhere = await createProduct(cookie, "Not On The Page", { price: 1000 });
    await createPage(cookie, "checkout-allowlist", [sold.id]);
    const before = await orderCount();

    // A real, active product — just not one this page sells.
    const response = await submitOrder({
      slug: "checkout-allowlist",
      items: [{ product: elsewhere.id, qty: 1 }],
      customer: CUSTOMER,
      totalCents: 2000,
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { fields?: Record<string, string> } };
    expect(body.error.fields?.items).toContain("no longer available");
    expect(await orderCount()).toBe(before);
  });

  it("refuses draft products and empty carts", async () => {
    const cookie = await sharedSession();
    const draft = await createProduct(cookie, "Unfinished Draft", {
      price: 1000,
      status: "draft",
    });
    await createPage(cookie, "checkout-draft", [draft.id]);

    const drafted = await submitOrder({
      slug: "checkout-draft",
      items: [{ product: draft.id, qty: 1 }],
      customer: CUSTOMER,
      totalCents: 2000,
    });
    expect(drafted.status).toBe(422);

    const empty = await submitOrder({
      slug: "checkout-draft",
      items: [],
      customer: CUSTOMER,
      totalCents: 0,
    });
    expect(empty.status).toBe(422);
  });

  it("404s unknown and closed pages alike", async () => {
    const cookie = await sharedSession();
    const candle = await createProduct(cookie, "Soy Candle", { price: 3200 });
    const page = await createPage(cookie, "checkout-paused", [candle.id]);
    await SELF.fetch(`${ORIGIN}/api/salespages/${page.id}`, {
      method: "PATCH",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ status: "closed" }),
    });

    const closed = await submitOrder({
      slug: "checkout-paused",
      items: [{ product: candle.id, qty: 1 }],
      customer: CUSTOMER,
      totalCents: 4200,
    });
    expect(closed.status).toBe(404);

    const unknown = await submitOrder({
      slug: "never-heard-of-it",
      items: [{ product: candle.id, qty: 1 }],
      customer: CUSTOMER,
      totalCents: 4200,
    });
    expect(unknown.status).toBe(404);
  });
});

describe("order detail", () => {
  it("returns one order with payment, fulfilment and journey events", async () => {
    const cookie = await sharedSession();
    const ebook = await createProduct(cookie, "Detail Ebook", {
      price: 1800,
      type: "digital",
      fulfilment: { shipment: false, download: true },
    });
    // A featured image is snapshotted onto the order's item.
    const imagePath = `products/${ebook.id}/${crypto.randomUUID()}.webp`;
    const withImage = await SELF.fetch(`${ORIGIN}/api/products/${ebook.id}`, {
      method: "PATCH",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ featured: imagePath }),
    });
    expect(withImage.status).toBe(200);
    await createPage(cookie, "order-detail", [ebook.id]);

    const visitedAt = new Date(Date.now() - 60_000).toISOString();
    const addedAt = new Date(Date.now() - 30_000).toISOString();
    const created = await submitOrder({
      slug: "order-detail",
      items: [{ product: ebook.id, qty: 2 }],
      customer: CUSTOMER,
      totalCents: 3600,
      events: { visitedAt, addedAt },
    });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { order: { id: string } }).order.id;

    const response = await SELF.fetch(`${ORIGIN}/api/orders/${id}`, {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    const order = (await response.json()) as {
      id: string;
      orderNo: string;
      customerNo: string | null;
      customerId: string | null;
      paidAt: string | null;
      payment: unknown;
      fulfilment: { status: string; fulfilledAt: string | null; deliveredAt: string | null };
      events: { visitedAt: string | null; addedAt: string | null };
      customerOrders: number;
      customerLtvCents: number;
      customer: { name: string; email: string; country?: string };
      items: Array<{ name: string; image?: string | null }>;
    };
    expect(order.id).toBe(id);
    expect(order.orderNo).toMatch(/^#\d{4,}$/);
    expect(order.customerNo).toMatch(/^#\d{4,}$/);
    const customerId = await env.DB.prepare("SELECT id FROM customers WHERE email = ?")
      .bind(CUSTOMER.email)
      .first<{ id: number }>();
    expect(order.customerNo).toBe(formatCustomerNo(customerId?.id ?? 0));
    const customerUuid = await env.DB.prepare("SELECT uuid FROM customers WHERE email = ?")
      .bind(CUSTOMER.email)
      .first<{ uuid: string }>();
    expect(order.customerId).toBe(customerUuid?.uuid);
    expect(order.items[0]?.image).toBe(imagePath);
    expect(order.paidAt).toBeNull();
    expect(order.payment).toBeNull();
    // Digital-only: nothing ships, so it is fulfilled the moment it is placed.
    expect(order.fulfilment.status).toBe("fulfilled");
    expect(order.fulfilment.fulfilledAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(order.fulfilment.deliveredAt).toBeNull();
    // Browser times are converted to the app's KL wall-clock.
    expect(order.events.visitedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(order.events.addedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(order.customerOrders).toBe(0);
    expect(order.customer.name).toBe(CUSTOMER.name);
    expect(order.customer.email).toBe(CUSTOMER.email);
    expect(order.customer.country).toBe("MY");

    // Paying it (admin test) stamps paidAt and the customer's paid-order count.
    const paid = await SELF.fetch(`${ORIGIN}/api/orders/${id}/test`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ outcome: "success" }),
    });
    expect(paid.status).toBe(200);
    const paidOrder = (await (
      await SELF.fetch(`${ORIGIN}/api/orders/${id}`, { headers: { Cookie: cookie } })
    ).json()) as {
      status: string;
      paidAt: string | null;
      customerOrders: number;
      customerLtvCents: number;
      payment: unknown;
    };
    expect(paidOrder.status).toBe("paid");
    expect(paidOrder.paidAt).not.toBeNull();
    expect(paidOrder.customerOrders).toBe(1);
    expect(paidOrder.customerLtvCents).toBe(3600);
    expect(paidOrder.payment).toBeNull(); // test checkout has no gateway record

    // A digital order can't be sent back to unfulfilled.
    const unfulfil = await SELF.fetch(`${ORIGIN}/api/orders/${id}/fulfilment`, {
      method: "PATCH",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ status: "unfulfilled" }),
    });
    expect(unfulfil.status).toBe(422);

    // Junk and future timestamps are dropped rather than stored.
    const junk = await submitOrder({
      slug: "order-detail",
      items: [{ product: ebook.id, qty: 1 }],
      customer: CUSTOMER,
      totalCents: 1800,
      events: { visitedAt: "not-a-date", addedAt: new Date(Date.now() + 86_400_000).toISOString() },
    });
    const junkId = ((await junk.json()) as { order: { id: string } }).order.id;
    const junkOrder = (await (
      await SELF.fetch(`${ORIGIN}/api/orders/${junkId}`, { headers: { Cookie: cookie } })
    ).json()) as { events: { visitedAt: string | null; addedAt: string | null } };
    expect(junkOrder.events).toEqual({ visitedAt: null, addedAt: null });
  });

  it("moves fulfilment through fulfilled and delivered, then back", async () => {
    const cookie = await sharedSession();
    const product = await createProduct(cookie, "Fulfil Item", { price: 1200 });
    await createPage(cookie, "order-fulfil", [product.id]);
    const created = await submitOrder({
      slug: "order-fulfil",
      items: [{ product: product.id, qty: 1 }],
      customer: CUSTOMER,
      totalCents: 2200,
    });
    const id = ((await created.json()) as { order: { id: string } }).order.id;

    const patch = (status: string) =>
      SELF.fetch(`${ORIGIN}/api/orders/${id}/fulfilment`, {
        method: "PATCH",
        headers: jsonHeaders(cookie),
        body: JSON.stringify({ status }),
      });

    const fulfilled = await patch("fulfilled");
    expect(fulfilled.status).toBe(200);
    const fulfilledBody = (await fulfilled.json()) as {
      fulfilment: { status: string; fulfilledAt: string | null; deliveredAt: string | null };
    };
    expect(fulfilledBody.fulfilment.status).toBe("fulfilled");
    expect(fulfilledBody.fulfilment.fulfilledAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(fulfilledBody.fulfilment.deliveredAt).toBeNull();

    const delivered = await patch("delivered");
    const deliveredBody = (await delivered.json()) as {
      fulfilment: { status: string; fulfilledAt: string | null; deliveredAt: string | null };
    };
    expect(deliveredBody.fulfilment.status).toBe("delivered");
    expect(deliveredBody.fulfilment.fulfilledAt).toBe(fulfilledBody.fulfilment.fulfilledAt);
    expect(deliveredBody.fulfilment.deliveredAt).toMatch(/^\d{4}-\d{2}-\d{2}/);

    const reset = await patch("unfulfilled");
    const resetBody = (await reset.json()) as {
      fulfilment: { status: string; fulfilledAt: string | null; deliveredAt: string | null };
    };
    expect(resetBody.fulfilment).toEqual({
      status: "unfulfilled",
      fulfilledAt: null,
      deliveredAt: null,
    });

    expect((await patch("shipped")).status).toBe(422);

    const anon = await SELF.fetch(`${ORIGIN}/api/orders/${id}`, {});
    expect(anon.status).toBe(401);
    const missing = await SELF.fetch(
      `${ORIGIN}/api/orders/ord-0199f3c2-0000-7000-8000-000000000000`,
      { headers: { Cookie: cookie } },
    );
    expect(missing.status).toBe(404);
  });
});

describe("merchant order list", () => {
  it("returns every order, with no 500-row cap", async () => {
    const cookie = await sharedSession();
    const now = "2026-11-06 10:00:00";
    const data = JSON.stringify({
      items: [],
      subtotalCents: 0,
      shippingCents: 0,
      totalCents: 0,
      createdAt: now,
      updatedAt: now,
    });
    const prefix = `ord-cap_${crypto.randomUUID().slice(0, 8)}`;
    const insert = env.DB.prepare(
      "INSERT INTO orders (uuid, sales_page_id, status, data) VALUES (?, 1, 'pending', ?)",
    );
    const statements = Array.from({ length: 520 }, (_, index) =>
      insert.bind(`${prefix}_${String(index).padStart(4, "0")}`, data),
    );
    try {
      for (let i = 0; i < statements.length; i += 50) {
        await env.DB.batch(statements.slice(i, i + 50));
      }
      const response = await SELF.fetch(`${ORIGIN}/api/orders`, {
        headers: { Cookie: cookie },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { orders: unknown[] };
      expect(body.orders.length).toBeGreaterThanOrEqual(520);
    } finally {
      await env.DB.prepare("DELETE FROM orders WHERE uuid LIKE ?").bind(`${prefix}%`).run();
    }
  });

  it("requires a session", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/orders`);
    expect(response.status).toBe(401);
  });

  it("lists newest first with the page's name, and filters by page", async () => {
    const cookie = await sharedSession();
    const socks = await createProduct(cookie, "Merino Socks", { price: 2900 });
    const page = await createPage(cookie, "checkout-listed", [socks.id]);

    const first = await submitOrder({
      slug: "checkout-listed",
      items: [{ product: socks.id, qty: 1 }],
      customer: CUSTOMER,
      totalCents: 3900,
    });
    expect(first.status).toBe(201);
    const second = await submitOrder({
      slug: "checkout-listed",
      items: [{ product: socks.id, qty: 3 }],
      customer: CUSTOMER,
      totalCents: 9700,
    });
    expect(second.status).toBe(201);

    const list = await SELF.fetch(`${ORIGIN}/api/orders`, { headers: { Cookie: cookie } });
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      orders: { id: string; page: { name: string; slug: string }; totalCents: number }[];
    };
    const mine = body.orders.filter((order) => order.page.slug === "checkout-listed");
    expect(mine).toHaveLength(2);
    const [newest, older] = mine as { id: string; totalCents: number; page: { name: string } }[];
    // uuidv7 sorts by time; the endpoint returns newest first.
    expect(newest!.id > older!.id).toBe(true);
    expect(newest!.totalCents).toBe(9700);
    expect(newest!.page.name).toBe("Checkout Page");

    // ?page= narrows to one page's orders…
    const filtered = await SELF.fetch(`${ORIGIN}/api/orders?page=${page.id}`, {
      headers: { Cookie: cookie },
    });
    const filteredBody = (await filtered.json()) as { orders: { page: { slug: string } }[] };
    expect(filteredBody.orders.every((order) => order.page.slug === "checkout-listed")).toBe(true);

    // …and an unknown page id is a 404, not a silent empty list.
    const missing = await SELF.fetch(`${ORIGIN}/api/orders?page=spg-00000000-0000-7000-8000-000000000000`, {
      headers: { Cookie: cookie },
    });
    expect(missing.status).toBe(404);
  });
});

/**
 * Last in the file on purpose: the window is per client IP for the whole test
 * pool, and this loop burns it out. Invalid bodies cost the limiter the same
 * as valid ones (the check runs before the parse), so nothing is inserted.
 */
describe("public order rate limit", () => {
  it("429s once the hourly window is exhausted", async () => {
    let limited: Response | null = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await submitOrder({ not: "an order" });
      if (response.status === 429) {
        limited = response;
        break;
      }
    }
    expect(limited).not.toBeNull();
    expect(limited?.headers.get("retry-after")).toBeTruthy();
    const body = (await limited!.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rate_limited");
  });
});
