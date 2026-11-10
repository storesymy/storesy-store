import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { recomputeAggregates, softDeleteContact } from "../src/models/customers.repository";

/**
 * The write side of customers: one identity per email, many contact profiles,
 * country required when shipping, soft delete, and the paid-order aggregates.
 */

const ORIGIN = "http://example.com";

let session: Promise<string> | null = null;
function sharedSession(): Promise<string> {
  session ??= (async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Customer Flow Tester",
        email: `flow-${crypto.randomUUID()}@example.com`,
        password: "correct horse battery",
      }),
    });
    expect(response.status).toBe(201);
    return (response.headers.get("set-cookie") as string).split(";")[0] as string;
  })();
  return session;
}

const jsonHeaders = (cookie: string) => ({ "Content-Type": "application/json", Cookie: cookie });

async function createProduct(cookie: string, name: string, shipping: boolean): Promise<string> {
  const created = await SELF.fetch(`${ORIGIN}/api/products`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ name, type: shipping ? "physical" : "digital" }),
  });
  expect(created.status).toBe(201);
  const product = (await created.json()) as { id: string };
  const patched = await SELF.fetch(`${ORIGIN}/api/products/${product.id}`, {
    method: "PATCH",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({
      name,
      type: shipping ? "physical" : "digital",
      price: 2000,
      fulfilment: shipping
        ? { shipment: true, download: false }
        : { shipment: false, download: true },
    }),
  });
  expect(patched.status).toBe(200);
  return product.id;
}

async function createPage(cookie: string, slug: string, products: string[]): Promise<void> {
  const created = await SELF.fetch(`${ORIGIN}/api/salespages`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ name: "Customer Flow Page", slug, products }),
  });
  expect(created.status).toBe(201);
}

interface Customer {
  id: number;
  name: string;
  email: string;
  countryCode: string | null;
  countryName: string | null;
  ltvCents: number;
  totalCheckout: number;
  lastCheckoutDate: string | null;
  badge: string | null;
}

async function customerByEmail(email: string): Promise<Customer> {
  const row = await env.DB.prepare(
    "SELECT id, name, email, country_code AS countryCode, country_name AS countryName, ltv_cents AS ltvCents, total_checkout AS totalCheckout, last_checkout_date AS lastCheckoutDate, badge FROM customers WHERE email = ?",
  )
    .bind(email)
    .first<Customer>();
  if (!row) throw new Error("customer missing");
  return row;
}

async function activeContacts(customerId: number) {
  return env.DB.prepare(
    "SELECT id, name, phone, data FROM customer_contact WHERE customer_id = ? AND deleted_at IS NULL ORDER BY id",
  )
    .bind(customerId)
    .all<{ id: number; name: string; phone: string; data: string }>();
}

async function placeOrder(
  slug: string,
  product: string,
  customer: Record<string, unknown>,
): Promise<{ id: string; status: number }> {
  const response = await SELF.fetch(`${ORIGIN}/api/public/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      slug,
      items: [{ product, qty: 1 }],
      customer,
      totalCents: 2000 + (customer.address ? 1000 : 0),
    }),
  });
  const body = (await response.json()) as { order?: { id: string } };
  return { id: body.order?.id ?? "", status: response.status };
}

const SHIPPING_CUSTOMER = {
  name: "Siti Aminah",
  phone: "0123456789",
  email: "siti@example.com",
  address: "12 Jalan Merdeka",
  postcode: "50000",
  city: "Kuala Lumpur",
  state: "Selangor",
  country: "MY",
};

describe("customer write flow", () => {
  it("requires a destination country when the cart ships, and stores it", async () => {
    const cookie = await sharedSession();
    const product = await createProduct(cookie, "Flow Physical", true);
    await createPage(cookie, "flow-ship", [product]);

    const withoutCountry = await placeOrder("flow-ship", product, {
      ...SHIPPING_CUSTOMER,
      email: `no-country-${crypto.randomUUID()}@example.com`,
      country: undefined,
    });
    expect(withoutCountry.status).toBe(422);

    const ok = await placeOrder("flow-ship", product, SHIPPING_CUSTOMER);
    expect(ok.status).toBe(201);

    const customer = await customerByEmail("siti@example.com");
    expect(customer.countryCode).toBe("MY");
    expect(customer.countryName).toBe("Malaysia");

    const contacts = await activeContacts(customer.id);
    expect(contacts.results).toHaveLength(1);
    const data = JSON.parse(contacts.results[0]!.data) as { countryCode: string; address: string };
    expect(data.countryCode).toBe("MY");
    expect(data.address).toBe("12 Jalan Merdeka");
  });

  it("reuses an identical contact, adds one for changed details, and never reuses a deleted one", async () => {
    const cookie = await sharedSession();
    const product = await createProduct(cookie, "Flow Digital", false);
    await createPage(cookie, "flow-contacts", [product]);
    const email = `contacts-${crypto.randomUUID().slice(0, 8)}@example.com`;

    const base = { name: "Aina Rahman", phone: "0123456789", email };
    expect((await placeOrder("flow-contacts", product, base)).status).toBe(201);
    // Same details again → the same active contact.
    expect((await placeOrder("flow-contacts", product, base)).status).toBe(201);

    const customer = await customerByEmail(email);
    let contacts = await activeContacts(customer.id);
    expect(contacts.results).toHaveLength(1);

    // A different phone is a different shipping profile.
    expect(
      (await placeOrder("flow-contacts", product, { ...base, phone: "0198887777" })).status,
    ).toBe(201);
    contacts = await activeContacts(customer.id);
    expect(contacts.results).toHaveLength(2);

    // Soft-delete the first, then order with its details: a fresh row, not the
    // deleted one (and the deleted row still exists for its old orders).
    expect(await softDeleteContact(env, contacts.results[0]!.id)).toBe(true);
    expect(
      (await placeOrder("flow-contacts", product, base)).status,
    ).toBe(201);
    contacts = await activeContacts(customer.id);
    expect(contacts.results).toHaveLength(2); // phone 0198 + the re-added base
    const all = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM customer_contact WHERE customer_id = ?",
    )
      .bind(customer.id)
      .first<{ n: number }>();
    expect(all?.n).toBe(3); // two active + the soft-deleted one
  });

  it("recomputes LTV, checkout count and last date from paid orders", async () => {
    const cookie = await sharedSession();
    const product = await createProduct(cookie, "Flow Paid", false);
    await createPage(cookie, "flow-paid", [product]);
    const email = `paid-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const customer = { name: "Paid Buyer", phone: "0123456789", email };

    const first = await placeOrder("flow-paid", product, customer);
    const second = await placeOrder("flow-paid", product, customer);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const row = await customerByEmail(email);
    expect(row.totalCheckout).toBe(0);

    // Both orders become paid; the second is an admin test checkout, which
    // still counts toward the customer's paid totals.
    await env.DB.prepare(
      "UPDATE orders SET status = 'paid' WHERE uuid = ?",
    ).bind(first.id).run();
    await env.DB.prepare(
      "UPDATE orders SET status = 'paid', data = json_set(data, '$.test', 1) WHERE uuid = ?",
    ).bind(second.id).run();

    await recomputeAggregates(env, row.id);
    const after = await customerByEmail(email);
    expect(after.totalCheckout).toBe(2);
    expect(after.ltvCents).toBe(4000);
    expect(after.lastCheckoutDate).not.toBeNull();
    expect(after.badge).toBe("repeat"); // automatic: two paid checkouts
  });
});
