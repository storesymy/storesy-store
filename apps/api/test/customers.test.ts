import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { formatCustomerNo } from "@storesy/shared";

/**
 * GET /api/customers — the customers screen's data: 30 per page, server-side
 * search on name, email or an active contact's name/phone. Rows are seeded
 * directly: the write path (checkout) has its own suite.
 */

const ORIGIN = "http://example.com";

let cookie: string;
let ainaId: number;

async function signup(): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Customers Tester",
      email: `customers-${crypto.randomUUID()}@example.com`,
      password: "correct horse battery",
    }),
  });
  expect(response.status).toBe(201);
  return (response.headers.get("set-cookie") as string).split(";")[0] as string;
}

interface SeedContact {
  name?: string;
  phone?: string;
  address?: string;
  city?: string;
}

async function seed(
  name: string,
  email: string,
  contact?: SeedContact,
): Promise<{ customerId: number; contactId: number | null }> {
  const inserted = await env.DB.prepare(
    "INSERT INTO customers (uuid, email, name) VALUES (?, ?, ?) RETURNING id",
  )
    .bind(`cus-test_${crypto.randomUUID()}`, email, name)
    .first<{ id: number }>();
  if (!inserted) throw new Error("customer insert returned no row");
  if (!contact) return { customerId: inserted.id, contactId: null };

  const contactRow = await env.DB.prepare(
    `INSERT INTO customer_contact (uuid, customer_id, name, phone, data, fingerprint)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      `cdt-test_${crypto.randomUUID()}`,
      inserted.id,
      contact.name ?? name,
      contact.phone ?? "",
      JSON.stringify({
        address: contact.address ?? "",
        city: contact.city ?? "",
        postcode: "",
        state: "",
      }),
      crypto.randomUUID(),
    )
    .first<{ id: number }>();
  return { customerId: inserted.id, contactId: contactRow?.id ?? null };
}

beforeAll(async () => {
  cookie = await signup();
  // 34 filler rows — enough to cross the 30-row page boundary.
  for (let i = 1; i <= 34; i += 1) {
    const suffix = String(i).padStart(2, "0");
    await seed(`Bulk Customer ${suffix}`, `bulk${suffix}@example.com`, {
      phone: `0110000${suffix}`,
    });
  }
  const aina = await seed("Aina Rahman", "aina@example.com", {
    phone: "0123456789",
    address: "12 Jalan Merdeka",
    city: "Kuala Lumpur",
  });
  ainaId = aina.customerId;
  // A customer whose *contact* carries a different name + phone — the search
  // must find it even though the customer row says none of that.
  await seed("Recipient Holder", "holder@example.com", {
    name: "Special Recipient",
    phone: "0199990000",
  });
  await seed("100% Cotton", "percent@example.com");
});

interface CustomersBody {
  customers: Array<{
    customerNo: string;
    id: string;
    name: string;
    email: string;
    badge: string | null;
    countryName: string | null;
    ltvCents: number;
    totalCheckout: number;
    lastCheckoutDate: string | null;
    contacts: number;
  }>;
  total: number;
  page: number;
  perPage: number;
}

async function list(query = ""): Promise<{ status: number; body: CustomersBody }> {
  const response = await SELF.fetch(`${ORIGIN}/api/customers${query}`, {
    headers: { Cookie: cookie },
  });
  const body = (await response.json()) as CustomersBody;
  return { status: response.status, body };
}

describe("customers list", () => {
  it("pages 30 at a time, newest first, with #-numbered rows and contact counts", async () => {
    const first = await list();
    expect(first.status).toBe(200);
    expect(first.body.perPage).toBe(30);
    expect(first.body.total).toBe(37);
    expect(first.body.page).toBe(1);
    expect(first.body.customers).toHaveLength(30);
    // Newest first: the percent customer was inserted last.
    expect(first.body.customers[0]?.name).toBe("100% Cotton");
    expect(first.body.customers[0]?.customerNo).toMatch(/^#\d{4,}$/);
    // Manual badge + country stay empty until set; aggregates start at zero.
    expect(first.body.customers[0]?.badge).toBeNull();
    expect(first.body.customers[0]?.countryName).toBeNull();
    expect(first.body.customers[0]?.ltvCents).toBe(0);
    expect(first.body.customers[0]?.totalCheckout).toBe(0);
    expect(first.body.customers[0]?.lastCheckoutDate).toBeNull();

    const second = await list("?page=2");
    expect(second.body.page).toBe(2);
    expect(second.body.customers).toHaveLength(7);

    const aina = (await list("?q=aina")).body.customers[0];
    expect(aina?.customerNo).toBe(formatCustomerNo(ainaId));
    expect(aina?.contacts).toBe(1);
  });

  it("searches customer name, email, and active contact name or phone", async () => {
    expect((await list("?q=AIN")).body.customers.map((c) => c.name)).toEqual(["Aina Rahman"]);
    expect((await list("?q=bulk01")).body.customers.map((c) => c.email)).toEqual([
      "bulk01@example.com",
    ]);
    expect((await list("?q=bulk")).body.total).toBe(34);

    // Only the contact knows these — the customer row says "Recipient Holder".
    expect((await list("?q=special%20recipient")).body.customers.map((c) => c.name)).toEqual([
      "Recipient Holder",
    ]);
    expect((await list("?q=0199990000")).body.customers.map((c) => c.name)).toEqual([
      "Recipient Holder",
    ]);

    expect((await list("?q=nothing-matches")).body.total).toBe(0);
  });

  it("treats LIKE wildcards as literal characters", async () => {
    const percent = await list("?q=%25"); // "%"
    expect(percent.body.total).toBe(1);
    expect(percent.body.customers[0]?.name).toBe("100% Cotton");

    const underscore = await list("?q=bulk0_");
    expect(underscore.body.total).toBe(0);
  });

  it("does not match soft-deleted contacts", async () => {
    const before = await list("?q=0199990000");
    expect(before.body.total).toBe(1);
    await env.DB.prepare(
      "UPDATE customer_contact SET deleted_at = datetime('now') WHERE phone = ?",
    )
      .bind("0199990000")
      .run();
    const after = await list("?q=0199990000");
    expect(after.body.total).toBe(0);
  });

  it("clamps an out-of-range page to the last one and honours perPage", async () => {
    const deep = await list("?page=99");
    expect(deep.body.page).toBe(2); // 37 rows / 30 → last page is 2
    expect(deep.body.customers).toHaveLength(7);

    const ten = await list("?perPage=10");
    expect(ten.body.perPage).toBe(10);
    expect(ten.body.customers).toHaveLength(10);
  });

  it("returns one customer with their active contact profiles", async () => {
    const aina = await env.DB.prepare("SELECT uuid FROM customers WHERE email = 'aina@example.com'")
      .first<{ uuid: string }>();
    expect(aina).not.toBeNull();

    const response = await SELF.fetch(`${ORIGIN}/api/customers/${aina?.uuid}`, {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    const detail = (await response.json()) as {
      customer: { customerNo: string; email: string; contacts: number; ltvCents: number };
      contacts: Array<{ name: string; phone: string; address?: string }>;
    };
    expect(detail.customer.customerNo).toBe(formatCustomerNo(ainaId));
    expect(detail.customer.email).toBe("aina@example.com");
    expect(detail.customer.contacts).toBe(1);
    expect(detail.contacts).toHaveLength(1);
    expect(detail.contacts[0]?.name).toBe("Aina Rahman");
    expect(detail.contacts[0]?.phone).toBe("0123456789");
    expect(detail.contacts[0]?.address).toBe("12 Jalan Merdeka");

    // Soft-deleted profiles drop out of the detail view (and the count).
    await env.DB.prepare(
      "UPDATE customer_contact SET deleted_at = datetime('now') WHERE customer_id = (SELECT id FROM customers WHERE email = 'aina@example.com')",
    ).run();
    const after = (await (
      await SELF.fetch(`${ORIGIN}/api/customers/${aina?.uuid}`, { headers: { Cookie: cookie } })
    ).json()) as { customer: { contacts: number }; contacts: unknown[] };
    expect(after.contacts).toHaveLength(0);
    expect(after.customer.contacts).toBe(0);

    expect((await SELF.fetch(`${ORIGIN}/api/customers/${aina?.uuid}`)).status).toBe(401);
    const missing = await SELF.fetch(
      `${ORIGIN}/api/customers/cus-0199f3c2-0000-7000-8000-000000000000`,
      { headers: { Cookie: cookie } },
    );
    expect(missing.status).toBe(404);
  });

  it("sorts by customer number and LTV, both directions, no DESC by default", async () => {
    await env.DB.prepare(
      "UPDATE customers SET ltv_cents = 500, total_checkout = 2, badge = 'repeat' WHERE email = 'aina@example.com'",
    ).run();
    await env.DB.prepare(
      "UPDATE customers SET ltv_cents = 900, total_checkout = 1, badge = 'new' WHERE email = 'percent@example.com'",
    ).run();
    await env.DB.prepare(
      "UPDATE customers SET ltv_cents = 100, total_checkout = 3, badge = 'repeat' WHERE email = 'holder@example.com'",
    ).run();

    const number = (customerNo: string): number => Number(customerNo.replace("#", ""));

    // Default: customer no DESC (newest first).
    const all = await list("?perPage=100");
    const nos = all.body.customers.map((c) => number(c.customerNo));
    expect(nos).toEqual([...nos].sort((a, b) => b - a));

    const asc = await list("?perPage=100&sort=no&dir=asc");
    const ascNos = asc.body.customers.map((c) => number(c.customerNo));
    expect(ascNos).toEqual([...ascNos].sort((a, b) => a - b));

    const ltvDesc = await list("?perPage=100&sort=ltv&dir=desc");
    const descValues = ltvDesc.body.customers.map((c) => c.ltvCents);
    expect(descValues).toEqual([...descValues].sort((a, b) => b - a));
    expect(descValues[0]).toBe(900);
    expect(ltvDesc.body.customers[0]?.name).toBe("100% Cotton");
    expect(ltvDesc.body.customers[0]?.badge).toBe("new");

    const ltvAsc = await list("?perPage=100&sort=ltv&dir=asc");
    const ascValues = ltvAsc.body.customers.map((c) => c.ltvCents);
    expect(ascValues).toEqual([...ascValues].sort((a, b) => a - b));
    expect(ascValues[ascValues.length - 1]).toBe(900);
  });

  it("is session-gated", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/customers`);
    expect(response.status).toBe(401);
  });
});
