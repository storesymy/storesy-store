import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Table conventions (every table, now and in the future):
 *
 * 1. `id` — bigint autoincrement primary key (SQLite `INTEGER PRIMARY KEY
 *    AUTOINCREMENT`, a 64-bit rowid). Foreign keys reference it.
 * 2. Model tables (User, Product, Order, …) carry a `uuid` column: UUID **v7**
 *    (time-ordered) with a three-letter object prefix for readability —
 *    `usr-…`, `prd-…`, `ord-…`. It is the public key: APIs return it and
 *    sessions/slugs reference it.
 * 3. Date-times are `text` in `YYYY-MM-DD HH:MM:SS`, always Asia/Kuala_Lumpur
 *    (UTC+08:00, fixed, no DST) — defaults use
 *    `strftime('%Y-%m-%d %H:%M:%S', 'now', '+8 hours')`.
 * 4. Model tables keep only `name` and fields that need indexing as columns;
 *    everything else lives in a `data` JSON column (guarded by `json_valid`).
 * 5. When a date-time column does need indexing, it is stored as two columns —
 *    one date (`YYYY-MM-DD`) and one time (`HH:MM:SS`) — never as one combined
 *    indexed datetime.
 *
 * Append-only schema changes: new columns are added with `drizzle-kit generate`
 * (a new migration file), never by editing an old one.
 */
export const users = sqliteTable(
  "users",
  {
    /** Internal row identifier: bigint autoincrement primary key. */
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Public identifier: prefixed UUIDv7, e.g. `usr-0199f3c2-…`. */
    uuid: text("uuid").notNull(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role")
      .notNull()
      .default("owner"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%d %H:%M:%S', 'now', '+8 hours'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%d %H:%M:%S', 'now', '+8 hours'))`),
  },
  (table) => [
    uniqueIndex("users_uuid_unique").on(table.uuid),
    uniqueIndex("users_email_unique").on(table.email),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

/** Fulfilment channels — both may be on, at least one must stay on. */
export interface ProductFulfilment {
  /** Physical delivery (Shipment). */
  shipment: boolean;
  /** Digital delivery (Download). */
  download: boolean;
}

/**
 * Everything about a product that isn't `name` or an indexed column
 * (schema convention 4). Money is stored in cents; timestamps follow the
 * `YYYY-MM-DD HH:MM:SS` Asia/Kuala_Lumpur format like every other datetime.
 * The human-facing id (`PRD-0001`) is derived from the rowid, not stored.
 */
export interface ProductData {
  /** Long-form copy for the product page; `""` until written. */
  description: string;
  /** Merchant-entered stock keeping unit, `""` until set (not the PRD code). */
  sku: string;
  /** Price in cents — integer money, never a float. */
  price: number;
  /** Sale price in cents; null when there's no discount running. */
  discountPrice: number | null;
  stock: number;
  status: "active" | "draft";
  type: "physical" | "digital";
  /** Shipping weight in kg; null until entered. */
  weightKg: number | null;
  /** Shipping box width in cm; null until entered. */
  widthCm: number | null;
  /** Shipping box height in cm; null until entered. */
  heightCm: number | null;
  /** Shipping box length in cm; null until entered. */
  lengthCm: number | null;
  /** Stored featured image path (R2), null until one is saved. */
  featured: string | null;
  /** Stored gallery image paths in save order; empty until any are saved. */
  gallery: string[];
  /** Stored digital files (R2): path + display name + size in bytes. */
  downloadFiles: { path: string; name: string; size: number }[];
  /** Merchant-supplied delivery URLs for digital products; empty until set. */
  downloadLinks: string[];
  /** Fulfilment channels (Shipment / Download) — at least one stays on. */
  fulfilment: ProductFulfilment;
  createdAt: string;
  updatedAt: string;
}

export const products = sqliteTable(
  "products",
  {
    /** Internal row identifier: bigint autoincrement primary key. */
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Public identifier: prefixed UUIDv7, e.g. `prd-0199f3c2-…`. */
    uuid: text("uuid").notNull(),
    name: text("name").notNull(),
    /** Non-indexed model fields — see ProductData. */
    data: text("data", { mode: "json" }).$type<ProductData>().notNull(),
  },
  (table) => [
    uniqueIndex("products_uuid_unique").on(table.uuid),
    check("products_data_json", sql`json_valid(${table.data})`),
  ],
);

export type ProductRow = typeof products.$inferSelect;
export type NewProductRow = typeof products.$inferInsert;

/** Editor type a sales page lives in — one HTML document slot per type. */
export type SalesPageHtmlSlot = "component" | "code" | "ai";

/**
 * Everything about a sales page that isn't `name` or an indexed column
 * (schema convention 4). The `html` map holds **R2 paths only** — one fixed
 * key per editor slot (`salespages/<spg-uuid>/<slot>.html`), overwritten in
 * place on save, so the recorded path never changes. Dates are
 * Asia/Kuala_Lumpur text like everywhere else.
 */
export interface SalesPageData {
  /** Social-proof counter, machine-managed (never accepted from clients). */
  visits: number;
  seo: { title: string; description: string; keywords: string };
  og: { title: string; description: string; image: string };
  /** Component-canvas sections; the SPA owns their schema. */
  sections: unknown[];
  /** Visual theme; the SPA owns this shape. */
  style: Record<string, unknown>;
  /** Product ids the checkout block sells, in listing order. */
  checkoutProducts: string[];
  /** Payment-gateway integration the checkout charges through (`itg-…`), or none. */
  paymentGateway: string | null;
  /** Email-sending integration (`itg-…`, Email category), or none. */
  emailSender: string | null;
  /** Tracking integrations the page reports to (`itg-…`), in add order. */
  trackings: string[];
  /** Editor type the page currently opens in. */
  htmlType: SalesPageHtmlSlot;
  /** Set when the code document came from the URL/file importer. */
  htmlMode?: "snapshot";
  source?: { url: string; importedAt: string };
  /** Stored documents: R2 path per editor slot; absent = nothing stored. */
  html: Partial<Record<SalesPageHtmlSlot, string>>;
  /**
   * R2 path of the rendered public document (`salespages/<uuid>/page.html`) —
   * the standalone HTML file `GET /<slug>` serves. Built by the SPA on each
   * save; absent = nothing stored yet, and the Worker serves a fallback shell.
   */
  pagePath?: string;
  createdAt: string;
  updatedAt: string;
}

export const salesPages = sqliteTable(
  "sales_pages",
  {
    /** Internal row identifier: bigint autoincrement primary key. */
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Public identifier: prefixed UUIDv7, e.g. `spg-0199f3c2-…`. */
    uuid: text("uuid").notNull(),
    name: text("name").notNull(),
    /** Public URL segment (`/<slug>`); unique across the install. */
    slug: text("slug").notNull(),
    /** `open` serves the public URL; `closed` shows the paused card. */
    status: text("status").notNull(),
    /** Non-indexed model fields — see SalesPageData. */
    data: text("data", { mode: "json" }).$type<SalesPageData>().notNull(),
  },
  (table) => [
    uniqueIndex("sales_pages_uuid_unique").on(table.uuid),
    uniqueIndex("sales_pages_slug_unique").on(table.slug),
    index("sales_pages_status_idx").on(table.status),
    check("sales_pages_data_json", sql`json_valid(${table.data})`),
  ],
);

export type SalesPageRow = typeof salesPages.$inferSelect;
export type NewSalesPageRow = typeof salesPages.$inferInsert;

/**
 * One line on an order as it was sold (schema convention 4): the product's
 * id and name, and the unit price in cents the buyer paid. Snapshotted at
 * purchase — a later product edit never rewrites a receipt.
 */
export interface OrderItemData {
  product: string;
  name: string;
  unitCents: number;
  qty: number;
  /** Featured-image path at purchase (older orders resolve it on read). */
  image?: string | null;
}

/**
 * Everything about an order that isn't an indexed column. Money is integer
 * cents like everywhere else; timestamps are Asia/Kuala_Lumpur text. The
 * totals are ALWAYS the server's computation — never the client's numbers.
 */
/**
 * What the chosen payment gateway said when the buyer was sent to it: which
 * integration, the gateway's own reference (a Billplz bill id, for example),
 * and the checkout URL. No credential ever lands here — only the pointer the
 * return trip needs to ask the gateway what happened.
 */
export interface OrderPaymentData {
  /** Provider id (`billplz`, …) — the adapter the return trip uses. */
  provider: string;
  /** The integration row the payment went through (`itg-…`). */
  integration: string;
  /** The gateway's reference for this transaction (Billplz: the bill id). */
  reference: string;
  /** Where the buyer was sent (`https://www.billplz.com/bills/…`). */
  url: string;
  createdAt: string;
  /** Set once the gateway confirmed the money arrived. */
  paidAt?: string;
}

/** Shipping progress the merchant keeps on the order. */
export interface OrderFulfilmentData {
  status: "unfulfilled" | "fulfilled" | "delivered";
  /** KL date-time the order was marked fulfilled. */
  fulfilledAt?: string;
  /** KL date-time the order was marked delivered. */
  deliveredAt?: string;
}

/** Buyer-journey beats captured by the checkout page. */
export interface OrderEventsData {
  /** When this browsing session first reached the sales page. */
  visitedAt?: string;
  /** When something was first added to the cart. */
  addedAt?: string;
}

export interface OrderData {
  items: OrderItemData[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  createdAt: string;
  updatedAt: string;
  /** Present once the buyer has been sent to a payment gateway. */
  payment?: OrderPaymentData;
  /**
   * Placed with the admin-only test controls (Success / Failed / Cancel):
   * the status is simulated and no money moved anywhere.
   */
  test?: boolean;
  /**
   * When each payment notification went out (KL date-time). Absent = not yet
   * sent; set only after the provider accepted the message, so a trigger that
   * races another one never double-sends.
   */
  notified?: { customer?: string; admin?: string };
  /** Shipping progress — absent means "unfulfilled" (older rows). */
  fulfilment?: OrderFulfilmentData;
  /** Visit/add-to-cart timestamps from the checkout session. */
  events?: OrderEventsData;
}

/**
 * The address half of a contact profile. Name and phone are columns (the UI
 * searches them); the rest stays JSON so the address shape can grow.
 */
export interface ContactData {
  address?: string;
  postcode?: string;
  city?: string;
  state?: string;
  countryCode?: string;
  countryName?: string;
}

/**
 * Buyers, deduplicated by email — one row per person across every checkout.
 * Identity aggregates (LTV, checkouts, last date) live here; the shipping
 * profiles used by checkouts live in `customer_contact`. `badge` is manual:
 * null until someone sets it. PII stays merchant-only: no public read exists.
 */
export const customers = sqliteTable(
  "customers",
  {
    /** Internal row identifier: bigint autoincrement primary key. */
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Public identifier: prefixed UUIDv7, e.g. `cus-0199f3c2-…`. */
    uuid: text("uuid").notNull(),
    /** Normalised (trimmed, lowercase) — the dedupe key. */
    email: text("email").notNull(),
    name: text("name").notNull(),
    /** Automatic badge: `new` after 1 paid checkout, `repeat` after 2+. */
    badge: text("badge"),
    /** Country of the latest shipping contact; null while none shipped. */
    countryCode: text("country_code"),
    countryName: text("country_name"),
    /** Lifetime value in cents across paid orders. */
    ltvCents: integer("ltv_cents").notNull().default(0),
    /** Paid orders. */
    totalCheckout: integer("total_checkout").notNull().default(0),
    /** KL date-time of the latest paid order. */
    lastCheckoutDate: text("last_checkout_date"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%d %H:%M:%S', 'now', '+8 hours'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%d %H:%M:%S', 'now', '+8 hours'))`),
  },
  (table) => [
    uniqueIndex("customers_uuid_unique").on(table.uuid),
    uniqueIndex("customers_email_unique").on(table.email),
    // The customers screen searches by name (and email); the name index keeps
    // that scan off the table.
    index("customers_name_idx").on(table.name),
  ],
);

export type CustomerRow = typeof customers.$inferSelect;
export type NewCustomerRow = typeof customers.$inferInsert;

/**
 * Shipping/contact profiles for a customer — one row per distinct set of
 * details. Soft-deleted (`deleted_at` set) so an order's shipping record is
 * never lost; the partial unique index only covers active rows.
 */
export const customerContacts = sqliteTable(
  "customer_contact",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Public identifier: prefixed UUIDv7, e.g. `cdt-0199f3c2-…`. */
    uuid: text("uuid").notNull(),
    /** The buyer this profile belongs to — rowid reference, indexed. */
    customerId: integer("customer_id").notNull(),
    /** Shipping recipient, indexed for the customers search. */
    name: text("name").notNull().default(""),
    /** Contact number, indexed for the customers search. */
    phone: text("phone").notNull().default(""),
    /** Address block — see ContactData. */
    data: text("data", { mode: "json" }).$type<ContactData>().notNull(),
    /** Hash of the normalised details — the dedupe key. */
    fingerprint: text("fingerprint").notNull(),
    /** NULL = active; set = soft-deleted (never reused, never lost). */
    deletedAt: text("deleted_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%d %H:%M:%S', 'now', '+8 hours'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%d %H:%M:%S', 'now', '+8 hours'))`),
  },
  (table) => [
    uniqueIndex("customer_contact_uuid_unique").on(table.uuid),
    uniqueIndex("customer_contact_fingerprint_unique")
      .on(table.customerId, table.fingerprint)
      .where(sql`deleted_at IS NULL`),
    index("customer_contact_customer_idx").on(table.customerId),
    index("customer_contact_name_idx").on(table.name),
    index("customer_contact_phone_idx").on(table.phone),
  ],
);

export type CustomerContactRow = typeof customerContacts.$inferSelect;
export type NewCustomerContactRow = typeof customerContacts.$inferInsert;

export const orders = sqliteTable(
  "orders",
  {
    /** Internal row identifier: bigint autoincrement primary key. */
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Public identifier: prefixed UUIDv7, e.g. `ord-0199f3c2-…`. */
    uuid: text("uuid").notNull(),
    /** The sales page that took the order — rowid reference, indexed. */
    salesPageId: integer("sales_page_id").notNull(),
    /**
     * The buyer — rowid reference into `customers`, indexed. Nullable at the
     * SQLite level (the column was added to a populated table); the checkout
     * always writes it, and reads fall back for a row it can't resolve.
     */
    customerId: integer("customer_id"),
    /** The shipping/contact profile used for this order, indexed. */
    customerContactId: integer("customer_contact_id"),
    /** `pending` until the gateway confirms the money; then `paid`. */
    status: text("status").notNull().default("pending"),
    /** Non-indexed model fields — see OrderData. */
    data: text("data", { mode: "json" }).$type<OrderData>().notNull(),
  },
  (table) => [
    uniqueIndex("orders_uuid_unique").on(table.uuid),
    index("orders_page_idx").on(table.salesPageId),
    index("orders_customer_idx").on(table.customerId),
    index("orders_contact_idx").on(table.customerContactId),
    index("orders_status_idx").on(table.status),
    check("orders_data_json", sql`json_valid(${table.data})`),
  ],
);

export type OrderRow = typeof orders.$inferSelect;
export type NewOrderRow = typeof orders.$inferInsert;

/**
 * Everything about an integration that isn't `name` or the indexed
 * `provider` column (schema convention 4). Per-brand field variance lives in
 * the shared catalogue — only the VALUES are stored here:
 *
 * - `settings` — non-secret config (domain, region, pixel id…), plaintext.
 * - `secrets`  — AES-256-GCM envelopes `v1.<b64 iv>.<b64 ct>`, AAD bound to
 *                `uuid:fieldKey` (see services/integrations.crypto.ts).
 *                Never leaves the server.
 * - `hints`    — `••••1234` per secret, computed at WRITE time, so list and
 *                detail reads display a mask without ever decrypting.
 *
 * Dates are Asia/Kuala_Lumpur text like everywhere else. No date columns:
 * nothing here needs a datetime index, so convention 5 doesn't fire.
 */
export interface IntegrationData {
  connected: boolean;
  connectedAt: string | null;
  settings: Record<string, string>;
  secrets: Record<string, string>;
  hints: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export const integrations = sqliteTable(
  "integrations",
  {
    /** Internal row identifier: bigint autoincrement primary key. */
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Public identifier: prefixed UUIDv7, e.g. `itg-0199f3c2-…`. */
    uuid: text("uuid").notNull(),
    /** User-defined label — every provider's `name` field lands here. */
    name: text("name").notNull(),
    /** Catalogue id (`chip`, `aws-ses`, …) — several rows may share one. */
    provider: text("provider").notNull(),
    /** Non-indexed model fields — see IntegrationData. */
    data: text("data", { mode: "json" }).$type<IntegrationData>().notNull(),
  },
  (table) => [
    uniqueIndex("integrations_uuid_unique").on(table.uuid),
    index("integrations_provider_idx").on(table.provider),
    check("integrations_data_json", sql`json_valid(${table.data})`),
  ],
);

export type IntegrationRow = typeof integrations.$inferSelect;
export type NewIntegrationRow = typeof integrations.$inferInsert;

/**
 * One automated email — the /templates gallery. The stable `key` names the
 * send site (`thank-you`); the merchant edits the subject and message, both
 * plain text with `{placeholder}` tokens filled per order at send time.
 */
export interface EmailTemplateData {
  description: string;
  subject: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export const emailTemplates = sqliteTable(
  "email_templates",
  {
    /** Internal row identifier: bigint autoincrement primary key. */
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Public identifier: prefixed UUIDv7, e.g. `tpl-0199f3c2-…`. */
    uuid: text("uuid").notNull(),
    /** Stable send-site key (`thank-you`) — unique, never shown as the id. */
    key: text("template_key").notNull(),
    name: text("name").notNull(),
    /** Non-indexed model fields — see EmailTemplateData. */
    data: text("data", { mode: "json" }).$type<EmailTemplateData>().notNull(),
  },
  (table) => [
    uniqueIndex("email_templates_uuid_unique").on(table.uuid),
    uniqueIndex("email_templates_key_unique").on(table.key),
    check("email_templates_data_json", sql`json_valid(${table.data})`),
  ],
);

export type EmailTemplateRow = typeof emailTemplates.$inferSelect;
export type NewEmailTemplateRow = typeof emailTemplates.$inferInsert;
