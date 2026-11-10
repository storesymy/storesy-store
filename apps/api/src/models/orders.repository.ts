import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { ContactData, CustomerRow, NewOrderRow, OrderData, OrderRow } from "./schema";
import { customerContacts, customers, orders, salesPages } from "./schema";

function db(env: Env) {
  return drizzle(env.DB);
}

/** One order joined with its page and its buyer (for the merchant list). */
export interface OrderWithPage {
  order: OrderRow;
  /** Page name at read time; null when the page row was deleted since. */
  pageName: string | null;
  pageSlug: string | null;
  /** The buyer row; null only for a row whose customer can't be resolved. */
  customer: CustomerRow | null;
  /** The shipping/contact profile this order used; null when unresolved. */
  contact: { id: number; name: string; phone: string; data: ContactData } | null;
}

/** The columns every order read needs: order + page name/slug + buyer. */
const selected = {
  order: orders,
  pageName: salesPages.name,
  pageSlug: salesPages.slug,
  customerId: customers.id,
  customerUuid: customers.uuid,
  customerEmail: customers.email,
  customerName: customers.name,
  customerTotalCheckout: customers.totalCheckout,
  customerLtvCents: customers.ltvCents,
  customerCreatedAt: customers.createdAt,
  customerUpdatedAt: customers.updatedAt,
  contactId: customerContacts.id,
  contactName: customerContacts.name,
  contactPhone: customerContacts.phone,
  contactData: customerContacts.data,
};

interface JoinedRow {
  order: OrderRow;
  pageName: string | null;
  pageSlug: string | null;
  customerId: number | null;
  customerUuid: string | null;
  customerEmail: string | null;
  customerName: string | null;
  customerTotalCheckout: number | null;
  customerLtvCents: number | null;
  customerCreatedAt: string | null;
  customerUpdatedAt: string | null;
  contactId: number | null;
  contactName: string | null;
  contactPhone: string | null;
  contactData: ContactData | null;
}

function shape(row: JoinedRow): OrderWithPage {
  return {
    order: row.order,
    pageName: row.pageName,
    pageSlug: row.pageSlug,
    customer:
      row.customerId === null
        ? null
        : {
            id: row.customerId,
            uuid: row.customerUuid ?? "",
            email: row.customerEmail ?? "",
            name: row.customerName ?? "",
            badge: null,
            countryCode: null,
            countryName: null,
            ltvCents: row.customerLtvCents ?? 0,
            totalCheckout: row.customerTotalCheckout ?? 0,
            lastCheckoutDate: null,
            createdAt: row.customerCreatedAt ?? "",
            updatedAt: row.customerUpdatedAt ?? "",
          },
    contact:
      row.contactId === null
        ? null
        : {
            id: row.contactId,
            name: row.contactName ?? "",
            phone: row.contactPhone ?? "",
            data: row.contactData ?? {},
          },
  };
}

/**
 * Orders, newest first (rowid order = creation order; the uuid is v7 too, but
 * the rowid is the join key and sorts identically). Like products and pages,
 * rows are not account-scoped — one install serves one catalogue. Every row is
 * returned: the merchant's list is the full history, and the optional rowid
 * filter narrows it to one sales page in SQL (never a post-fetch slice).
 */
export async function listOrders(env: Env, pageId?: number): Promise<OrderWithPage[]> {
  const base = db(env)
    .select(selected)
    .from(orders)
    .leftJoin(salesPages, eq(orders.salesPageId, salesPages.id))
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .leftJoin(customerContacts, eq(orders.customerContactId, customerContacts.id));
  const rows = await (pageId === undefined ? base : base.where(eq(orders.salesPageId, pageId)))
    .orderBy(desc(orders.id))
    .all();
  return rows.map((row) => shape(row as JoinedRow));
}

export async function insertOrder(env: Env, values: NewOrderRow): Promise<OrderRow> {
  const inserted = await db(env).insert(orders).values(values).returning().all();
  const created = inserted[0];
  if (!created) throw new Error("Order insert returned no row");
  return created;
}

/** One order by its public id, with its page and buyer — the return trip's lookup. */
export async function findOrderByUuid(env: Env, uuid: string): Promise<OrderWithPage | null> {
  const rows = await db(env)
    .select(selected)
    .from(orders)
    .leftJoin(salesPages, eq(orders.salesPageId, salesPages.id))
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .leftJoin(customerContacts, eq(orders.customerContactId, customerContacts.id))
    .where(eq(orders.uuid, uuid))
    .limit(1)
    .all();
  const row = rows[0];
  if (!row) return null;
  return shape(row as JoinedRow);
}

/** Lifecycle writes: status flips and the data blob (payment pointer, paidAt). */
export async function updateOrder(
  env: Env,
  id: number,
  values: { status?: string; data?: OrderData },
): Promise<OrderRow> {
  const updated = await db(env)
    .update(orders)
    .set({
      ...(values.status !== undefined ? { status: values.status } : {}),
      ...(values.data !== undefined ? { data: values.data } : {}),
    })
    .where(eq(orders.id, id))
    .returning()
    .all();
  const row = updated[0];
  if (!row) throw new Error("Order update returned no row");
  return row;
}
