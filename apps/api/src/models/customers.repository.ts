import { formatCustomerNo } from "@storesy/shared";
import type { Customer, CustomerContact } from "@storesy/shared";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { ContactData, CustomerContactRow, CustomerRow } from "./schema";
import { customerContacts, customers } from "./schema";
import { klNow } from "../services/time";
import { ID_PREFIX, entityUuid } from "../services/uuid";

/**
 * Customers — one row per buyer email. Identity aggregates (LTV, checkout
 * count, last date) live on the customer; the shipping/contact profiles used
 * by checkouts live in `customer_contact`, one row per distinct detail set,
 * soft-deleted rather than removed so an order's shipping record survives.
 */

function db(env: Env) {
  return drizzle(env.DB);
}

/** Emails are the identity key: trimmed and lowercased before any lookup. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface CustomerInput {
  name: string;
  phone: string;
  email: string;
  address?: string;
  postcode?: string;
  city?: string;
  state?: string;
  /** ISO alpha-2 + display name, when the checkout collected a country. */
  countryCode?: string;
  countryName?: string;
}

export async function findByEmail(env: Env, email: string): Promise<CustomerRow | null> {
  const rows = await db(env)
    .select()
    .from(customers)
    .where(eq(customers.email, normalizeEmail(email)))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

/** Look up by the public id — the `cus-…` uuid in URLs. */
export async function findByUuid(env: Env, uuid: string): Promise<CustomerRow | null> {
  const rows = await db(env).select().from(customers).where(eq(customers.uuid, uuid)).limit(1).all();
  return rows[0] ?? null;
}

export async function findById(env: Env, id: number): Promise<CustomerRow | null> {
  const rows = await db(env).select().from(customers).where(eq(customers.id, id)).limit(1).all();
  return rows[0] ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

/**
 * Find-or-create the customer by email, refreshing the name (and the country
 * mirror when this checkout shipped somewhere). Contact profiles are separate
 * — see `findOrCreateContact`.
 */
export async function upsertCustomer(env: Env, input: CustomerInput): Promise<CustomerRow> {
  const email = normalizeEmail(input.email);
  const now = klNow();
  const fields = {
    name: input.name,
    ...(input.countryCode
      ? { countryCode: input.countryCode, countryName: input.countryName ?? null }
      : {}),
    updatedAt: now,
  };

  const existing = await findByEmail(env, email);
  if (existing) {
    const updated = await db(env)
      .update(customers)
      .set(fields)
      .where(eq(customers.id, existing.id))
      .returning()
      .all();
    return updated[0] as CustomerRow;
  }

  try {
    const inserted = await db(env)
      .insert(customers)
      .values({
        uuid: entityUuid(ID_PREFIX.customer),
        email,
        ...fields,
        createdAt: now,
      })
      .returning()
      .all();
    return inserted[0] as CustomerRow;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await findByEmail(env, email);
    if (!raced) throw error;
    return raced;
  }
}

/** Deterministic hash of the normalised contact — the dedupe key. */
async function contactFingerprint(name: string, phone: string, data: ContactData): Promise<string> {
  const canonical = JSON.stringify({
    name: name.trim(),
    phone: phone.trim(),
    address: (data.address ?? "").trim(),
    postcode: (data.postcode ?? "").trim(),
    city: (data.city ?? "").trim(),
    state: (data.state ?? "").trim(),
    countryCode: (data.countryCode ?? "").trim().toUpperCase(),
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Reuse the customer's active contact for this exact detail set, or add one.
 * Soft-deleted rows are never reused (and never block a re-add). A concurrent
 * checkout that wins the unique index is re-read instead of failing.
 */
export async function findOrCreateContact(
  env: Env,
  customerId: number,
  input: CustomerInput,
): Promise<CustomerContactRow> {
  const data: ContactData = {
    address: input.address ?? "",
    postcode: input.postcode ?? "",
    city: input.city ?? "",
    state: input.state ?? "",
    ...(input.countryCode
      ? { countryCode: input.countryCode.toUpperCase(), countryName: input.countryName ?? "" }
      : {}),
  };
  const name = input.name.trim();
  const phone = input.phone.trim();
  const fingerprint = await contactFingerprint(name, phone, data);
  const now = klNow();

  const active = {
    customerId,
    fingerprint,
    deletedAt: isNull(customerContacts.deletedAt),
  };
  const existing = await db(env)
    .select()
    .from(customerContacts)
    .where(and(eq(customerContacts.customerId, active.customerId), eq(customerContacts.fingerprint, active.fingerprint), active.deletedAt))
    .limit(1)
    .all();
  if (existing[0]) {
    const touched = await db(env)
      .update(customerContacts)
      .set({ updatedAt: now })
      .where(eq(customerContacts.id, existing[0].id))
      .returning()
      .all();
    return touched[0] as CustomerContactRow;
  }

  try {
    const inserted = await db(env)
      .insert(customerContacts)
      .values({
        uuid: entityUuid(ID_PREFIX.contact),
        customerId,
        name,
        phone,
        data,
        fingerprint,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all();
    return inserted[0] as CustomerContactRow;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await db(env)
      .select()
      .from(customerContacts)
      .where(and(eq(customerContacts.customerId, customerId), eq(customerContacts.fingerprint, fingerprint), isNull(customerContacts.deletedAt)))
      .limit(1)
      .all();
    if (!raced[0]) throw error;
    return raced[0];
  }
}

/** Soft-delete a contact. Orders that used it keep pointing at it. */
export async function softDeleteContact(env: Env, contactId: number): Promise<boolean> {
  const result = await db(env)
    .update(customerContacts)
    .set({ deletedAt: klNow(), updatedAt: klNow() })
    .where(and(eq(customerContacts.id, contactId), isNull(customerContacts.deletedAt)))
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

/** The customers API's public shape. */
export function toDto(row: CustomerRow, contacts: number): Customer {
  return {
    customerNo: formatCustomerNo(row.id),
    id: row.uuid,
    name: row.name,
    email: row.email,
    badge: row.badge ?? null,
    countryCode: row.countryCode ?? null,
    countryName: row.countryName ?? null,
    ltvCents: row.ltvCents,
    totalCheckout: row.totalCheckout,
    lastCheckoutDate: row.lastCheckoutDate ?? null,
    contacts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The customer's active contact profiles, newest first. */
export async function listContacts(env: Env, customerId: number): Promise<CustomerContactRow[]> {
  return db(env)
    .select()
    .from(customerContacts)
    .where(and(eq(customerContacts.customerId, customerId), isNull(customerContacts.deletedAt)))
    .orderBy(desc(customerContacts.id))
    .all();
}

/** One contact profile's public shape. */
export function contactToDto(row: CustomerContactRow): CustomerContact {
  const data = row.data ?? {};
  return {
    id: row.uuid,
    name: row.name,
    phone: row.phone,
    ...(data.address ? { address: data.address } : {}),
    ...(data.postcode ? { postcode: data.postcode } : {}),
    ...(data.city ? { city: data.city } : {}),
    ...(data.state ? { state: data.state } : {}),
    ...(data.countryCode ? { countryCode: data.countryCode } : {}),
    ...(data.countryName ? { countryName: data.countryName } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const WILDCARD = /[\\%_]/g;

/** The search filter: customer name/email or an active contact's name/phone. */
function filterFor(search: string | undefined) {
  const needle = (search ?? "").trim().toLowerCase();
  const pattern = `%${needle.replace(WILDCARD, (char) => `\\${char}`)}%`;
  return sql`(
    lower(${customers.name}) LIKE ${pattern} ESCAPE '\\'
    OR ${customers.email} LIKE ${pattern} ESCAPE '\\'
    OR EXISTS (
      SELECT 1 FROM customer_contact cc
      WHERE cc.customer_id = ${customers.id} AND cc.deleted_at IS NULL
        AND (lower(cc.name) LIKE ${pattern} ESCAPE '\\' OR cc.phone LIKE ${pattern} ESCAPE '\\')
    )
  )`;
}

/** Total customers matching the search — for the pager. */
export async function count(env: Env, search?: string): Promise<number> {
  const counted = await db(env)
    .select({ n: sql<number>`count(*)` })
    .from(customers)
    .where(filterFor(search))
    .all();
  return Number(counted[0]?.n ?? 0);
}

export type CustomerSort = "no" | "ltv";
export type SortDirection = "asc" | "desc";

/** One page of customers with their active-contact counts, sortable. */
export async function listPage(
  env: Env,
  query: {
    search?: string;
    page: number;
    perPage: number;
    sort: CustomerSort;
    dir: SortDirection;
  },
): Promise<Array<{ customer: CustomerRow; contacts: number }>> {
  // `no` is the row id; `ltv` falls back to newest-first for ties.
  const order =
    query.sort === "ltv"
      ? [
          query.dir === "asc" ? asc(customers.ltvCents) : desc(customers.ltvCents),
          desc(customers.id),
        ]
      : [query.dir === "asc" ? asc(customers.id) : desc(customers.id)];
  const rows = await db(env)
    .select()
    .from(customers)
    .where(filterFor(query.search))
    .orderBy(...order)
    .limit(query.perPage)
    .offset((query.page - 1) * query.perPage)
    .all();
  if (rows.length === 0) return [];

  // Active contact counts in one grouped query — no correlated subquery.
  const ids = rows.map((row) => row.id);
  const counts = await db(env)
    .select({ customerId: customerContacts.customerId, n: sql<number>`count(*)` })
    .from(customerContacts)
    .where(and(isNull(customerContacts.deletedAt), inArray(customerContacts.customerId, ids)))
    .groupBy(customerContacts.customerId)
    .all();
  const byCustomer = new Map(counts.map((row) => [row.customerId, Number(row.n)]));
  return rows.map((customer) => ({
    customer,
    contacts: byCustomer.get(customer.id) ?? 0,
  }));
}

/**
 * Recompute the identity aggregates from paid orders. Idempotent, so gateway
 * callbacks, browser returns and admin test successes can all call it.
 *
 * Badge is derived here too: no paid order → null, one → `new`, two or more →
 * `repeat`. Admin test checkouts count, like they do for LTV.
 */
export async function recomputeAggregates(env: Env, customerId: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE customers SET
       total_checkout = (
         SELECT COUNT(*) FROM orders o
         WHERE o.customer_id = ?1 AND o.status = 'paid'
       ),
       ltv_cents = (
         SELECT COALESCE(SUM(CAST(json_extract(o.data, '$.totalCents') AS INTEGER)), 0)
         FROM orders o
         WHERE o.customer_id = ?1 AND o.status = 'paid'
       ),
       last_checkout_date = (
         SELECT MAX(COALESCE(json_extract(o.data, '$.payment.paidAt'), json_extract(o.data, '$.updatedAt')))
         FROM orders o
         WHERE o.customer_id = ?1 AND o.status = 'paid'
       ),
       badge = (
         SELECT CASE
           WHEN COUNT(*) = 0 THEN NULL
           WHEN COUNT(*) = 1 THEN 'new'
           ELSE 'repeat'
         END
         FROM orders o
         WHERE o.customer_id = ?1 AND o.status = 'paid'
       )
     WHERE id = ?1`,
  )
    .bind(customerId)
    .run();
}
