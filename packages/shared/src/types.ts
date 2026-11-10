import type { EmailTemplatePlaceholder } from "./emailTemplates";
import type { SalesPageHtmlSlot, SalesPageStatus } from "./schemas";

/** The public shape of a user. Never leaks password material. */
export interface User {
  /** Public id: prefixed UUIDv7, e.g. `usr-0199f3c2-…` (time-ordered). */
  id: string;
  email: string;
  name: string;
  /** Account role, e.g. `owner` (baseline) — shown in the sidebar identity block. */
  role: string;
  /** Account created at, `YYYY-MM-DD HH:MM:SS` in Asia/Kuala_Lumpur. */
  createdAt: string;
}

/** How a product reaches the customer — at least one channel stays on. */
export interface ProductFulfilment {
  /** Physical delivery (Shipment). */
  shipment: boolean;
  /** Digital delivery (Download). */
  download: boolean;
}

/** A stored digital file: path to the bytes, display name, size in bytes. */
export interface DownloadFile {
  path: string;
  name: string;
  size: number;
}

/** A product as the API returns it — money in cents, dates as KL text. */
export interface Product {
  /** Public id: prefixed UUIDv7, e.g. `prd-0199f3c2-…` (time-ordered). */
  id: string;
  name: string;
  /** Human-facing product id: `PRD-0001` — zero-padded rowid. */
  code: string;
  /** Long-form copy for the product page; `""` until written. */
  description: string;
  /**
   * Merchant-entered stock keeping unit, `""` until set — free-form and
   * unrelated to the derived `code` (`PRD-0001`), which is never editable.
   */
  sku: string;
  /** Price in cents — integer money; the UI divides by 100. */
  price: number;
  /** Sale price in cents; null when there's no discount running. */
  discountPrice: number | null;
  stock: number;
  status: "active" | "draft";
  type: "physical" | "digital";
  /** Stored featured image path (R2), null until one is saved. */
  featured: string | null;
  /** Stored gallery image paths in save order; empty until any are saved. */
  gallery: string[];
  /** Shipping weight in kg; null until entered. */
  weightKg: number | null;
  /** Shipping box width in cm; null until entered. */
  widthCm: number | null;
  /** Shipping box height in cm; null until entered. */
  heightCm: number | null;
  /** Shipping box length in cm; null until entered. */
  lengthCm: number | null;
  /** Merchant-supplied delivery URLs for digital products; empty until set. */
  downloadLinks: string[];
  /** Stored digital files (R2): path + display name + size in bytes. */
  downloadFiles: DownloadFile[];
  /** Fulfilment channels (Shipment / Download) — at least one stays on. */
  fulfilment: ProductFulfilment;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------- Sales Pages ------------------------- */

/** One stored HTML document's home in R2 (paths only, never the markup). */
export type SalesPageHtmlPaths = Partial<Record<SalesPageHtmlSlot, string>>;

/** The list table's row — HTML never rides along (it lives in R2). */
export interface SalesPageSummary {
  /** Public id: prefixed UUIDv7, e.g. `spg-0199f3c2-…`. */
  id: string;
  name: string;
  /** Public URL segment (`/<slug>`); unique across the install. */
  slug: string;
  status: SalesPageStatus;
  /** Social-proof counter, machine-managed (batched through the counter DO). */
  visits: number;
  /** Editor type the page currently opens in. */
  htmlType: SalesPageHtmlSlot;
  createdAt: string;
  updatedAt: string;
}

/** A sales page as the editor's detail view receives it. */
export interface SalesPage extends SalesPageSummary {
  seo: { title: string; description: string; keywords: string };
  og: { title: string; description: string; image: string };
  /** Component-canvas sections; the SPA owns their schema (opaque here). */
  sections: unknown[];
  /** Visual theme; the SPA owns this shape too. */
  style: unknown;
  /** Product ids the checkout block sells, in listing order. */
  checkoutProducts: string[];
  /** Payment-gateway integration the checkout charges through (`itg-…`), or none. */
  paymentGateway: string | null;
  /** Email-sending integration (`itg-…`, Email category), or none. */
  emailSender: string | null;
  /** Tracking integrations the page reports to (`itg-…`), in add order. */
  trackings: string[];
  /**
   * Hydrated documents, one per editor type — the API reads the R2 objects
   * the row's `html` paths point at, so the SPA keeps receiving markup
   * strings. A missing key = no document stored for that type.
   */
  htmlByType: Partial<Record<SalesPageHtmlSlot, string>>;
  /** Set when the code document came from the URL/file importer (framing). */
  htmlMode?: "snapshot";
  source?: { url: string; importedAt: string };
}

/* ------------------------------ Orders ------------------------------ */

/** One purchased line as the order recorded it (price snapshot at buy time). */
export interface OrderItem {
  /** Product id at purchase — the row may change or vanish later. */
  product: string;
  /** Product name at purchase (a snapshot — receipts never drift). */
  name: string;
  /** Unit price in cents the buyer paid (sale price when a discount ran). */
  unitCents: number;
  qty: number;
  /** Featured image path at purchase (resolved for older orders on read). */
  image?: string | null;
}

/** Buyer details as the checkout form submitted them (PII — merchant-only). */
export interface OrderCustomer {
  name: string;
  phone: string;
  email: string;
  address?: string;
  postcode?: string;
  city?: string;
  state?: string;
  /** ISO alpha-2 destination country, when it shipped. */
  country?: string;
}

/**
 * The human reference for an order, derived from its internal row id:
 * `#0001`, `#0321`, `#123882`. Numbers are zero-padded to four digits and
 * grow naturally past that. Display only — API paths and download
 * capabilities keep using the order's UUID.
 */
export function formatOrderNo(rowId: number): string {
  return `#${String(rowId).padStart(4, "0")}`;
}

/** A customer's human reference — same shape as an order's: `#0001`. */
export function formatCustomerNo(rowId: number): string {
  return `#${String(rowId).padStart(4, "0")}`;
}

/**
 * A buyer, deduplicated by email — the customers table's public shape.
 * `orders` reference this row; checkout refreshes the details on each order.
 */
export interface Customer {
  /** Public id: prefixed UUIDv7, e.g. `cus-0199f3c2-…`. */
  id: string;
  /** Human reference: `#0001` (derived from the row id). */
  customerNo: string;
  name: string;
  /** Normalised (trimmed, lowercase). */
  email: string;
  /** Automatic: `new` after one paid checkout, `repeat` after two or more. */
  badge: string | null;
  /** Country of the latest shipping contact; null for digital-only buyers. */
  countryCode: string | null;
  countryName: string | null;
  /** Lifetime value in cents over paid orders. */
  ltvCents: number;
  /** Paid orders. */
  totalCheckout: number;
  lastCheckoutDate: string | null;
  /** Active shipping/contact profiles on this email. */
  contacts: number;
  /** `Y-m-d H:i:s` Asia/Kuala_Lumpur — the app's date-time convention. */
  createdAt: string;
  updatedAt: string;
}

/** One shipping/contact profile on a customer. */
export interface CustomerContact {
  /** Public id: prefixed UUIDv7, e.g. `cdt-0199f3c2-…`. */
  id: string;
  name: string;
  phone: string;
  address?: string;
  postcode?: string;
  city?: string;
  state?: string;
  countryCode?: string;
  countryName?: string;
  createdAt: string;
  updatedAt: string;
}

/** One customer with their active contact profiles — the detail page. */
export interface CustomerDetail {
  customer: Customer;
  contacts: CustomerContact[];
}

/** One page of the customers list (server-side search + pagination). */
export interface CustomerPage {
  customers: Customer[];
  total: number;
  page: number;
  perPage: number;
}

/**
 * One automated email the store sends — the /templates card and its edit
 * dialog. `subject` and `body` are the live text (placeholders included), not
 * a compiled sample.
 */
export interface EmailTemplate {
  /** Public id: prefixed UUIDv7, e.g. `tpl-0199f3c2-…`. */
  id: string;
  /** Stable internal key, e.g. `thank-you`. */
  key: string;
  name: string;
  description: string;
  subject: string;
  /** Plain text, `{placeholder}` tokens included. */
  body: string;
  /** Tokens this template understands, with plain-language explanations. */
  placeholders: EmailTemplatePlaceholder[];
  /** `Y-m-d H:i:s` Asia/Kuala_Lumpur — the app's date-time convention. */
  updatedAt: string;
}

/** Shipping progress for an order (merchant-controlled). */
export type OrderFulfilmentStatus = "unfulfilled" | "fulfilled" | "delivered";

/** An order as the merchant's list receives it. */
export interface Order {
  /** Public id: prefixed UUIDv7, e.g. `ord-0199f3c2-…` (time-ordered). */
  id: string;
  /** Human reference shown in every UI surface and email: `#0001`. */
  orderNo: string;
  /** The buyer's customer reference (`#0001`), when the row resolves. */
  customerNo: string | null;
  /** The buyer's public customer id (`cus-…`) — links to /customer/<uuid>. */
  customerId: string | null;
  /** The sales page that took the order — name + slug at read time. */
  page: { name: string; slug: string };
  /** `pending` until the gateway confirms the money; then `paid`. */
  status: string;
  /** True for orders placed with the admin's test controls — no money moved. */
  test: boolean;
  items: OrderItem[];
  customer: OrderCustomer;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  /** When payment landed (test checkouts use the status-change time). */
  paidAt: string | null;
  /** Gateway details for a checkout that reached one; null for test/never. */
  payment: {
    provider: string;
    reference: string;
    /** Gateway's hosted payment page. */
    url: string;
  } | null;
  /** Shipping progress and its timestamps. */
  fulfilment: {
    status: OrderFulfilmentStatus;
    fulfilledAt: string | null;
    deliveredAt: string | null;
  };
  /** Buyer-journey timestamps captured by the checkout (null when unknown). */
  events: {
    visitedAt: string | null;
    addedAt: string | null;
  };
  /** The buyer's paid order count, shown on the order detail page. */
  customerOrders: number;
  /** The buyer's lifetime value in cents (paid orders). */
  customerLtvCents: number;
  /** `Y-m-d H:i:s` Asia/Kuala_Lumpur — the app's date-time convention. */
  createdAt: string;
}

/** The storefront shapes a merchant can publish. */
export type StoreType =
  | "coming-soon"
  | "ecommerce"
  | "sales-page"
  | "link-tree"
  | "custom-html";

/** Editable copy for the Coming Soon storefront type. */
export interface StoreComingSoon {
  /** Headline shown on the banner. */
  banner: string;
  /** Text repeated across the scrolling marquee (defaults to the store name). */
  marquee: string;
}

/** One row in a Link Tree storefront. */
export interface StoreLink {
  id: string;
  label: string;
  url: string;
}

/** Hand-written storefront code for the Custom HTML type. */
export interface StoreCode {
  html: string;
  css: string;
  js: string;
}

/**
 * A merchant's storefront. UI-only for now (local state seam); maps 1:1 onto the
 * future `stores` table plus its links/code rows when the API phase lands.
 */
export interface Store {
  id: string;
  /** Customer-facing store name. */
  name: string;
  /**
   * URL segment for the future public domain (`<slug>.storesy.shop`).
   * Until then the store is served from the app's current origin.
   */
  slug: string;
  tagline: string;
  /** Link Tree handle, without the leading @. */
  handle: string;
  type: StoreType;
  /** `draft` hides the store from the public URL until published. */
  status: "draft" | "active";
  currency: string;
  /** Thin announcement bar shown at the top of eCommerce / Sales Page views. */
  announcement: string;
  links: StoreLink[];
  code: StoreCode;
  comingSoon: StoreComingSoon;
  createdAt: number;
  updatedAt: number;
}

/** Single error envelope used by every non-2xx API response. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Field-level validation messages, keyed by form field. */
    fields?: Record<string, string>;
  };
}

/* ------------------------- /system (database viewer) ---------------------- */

/** GET /api/db/config — what the /system connection card renders. */
export interface DbConfig {
  /**
   * Where rows physically live right now:
   * `local-sqlite` = a SQLite file on this machine (miniflare / `wrangler dev`),
   * `cloudflare-d1` = Cloudflare's managed D1 service.
   */
  storage: "local-sqlite" | "cloudflare-d1";
  /** The storage location spelled out (file location vs managed service). */
  location: string;
  engine: string;
  environment: string;
  host: string;
  user: string;
  name: string;
}

/** One entry in the /system table list. */
export interface DbTable {
  name: string;
  type: "table" | "view";
  /** Row count; null when it could not be computed (e.g. a broken view). */
  rows: number | null;
}

/** One column from PRAGMA table_info. */
export interface DbColumn {
  name: string;
  type: string;
  notnull: boolean;
  dflt: string | null;
  pk: boolean;
}

export interface DbIndex {
  name: string;
  unique: boolean;
  origin: string;
  columns: string[];
}

export interface DbForeignKey {
  table: string;
  from: string;
  to: string | null;
  onDelete: string;
  onUpdate: string;
}

/** GET /api/db/tables/:table/structure */
export interface DbStructure {
  table: string;
  columns: DbColumn[];
  indexes: DbIndex[];
  foreignKeys: DbForeignKey[];
}

/** GET /api/db/tables/:table/data — rows are positional, aligned to `columns`. */
export interface DbDataPage {
  table: string;
  columns: string[];
  rows: unknown[][];
  total: number;
  page: number;
  pageSize: number;
}

export const API_BASE = "/api";

/** Route table shared so the client can never drift from the server. */
export const routes = {
  signup: `${API_BASE}/auth/signup`,
  login: `${API_BASE}/auth/login`,
  logout: `${API_BASE}/auth/logout`,
  me: `${API_BASE}/me`,
  health: `${API_BASE}/health`,
  products: `${API_BASE}/products`,
  salesPages: `${API_BASE}/salespages`,
  orders: `${API_BASE}/orders`,
  customers: `${API_BASE}/customers`,
  templates: `${API_BASE}/templates`,
  integrations: `${API_BASE}/integrations`,
  /** The checkout block's signed-out submit — same-origin from `/<slug>`. */
  publicOrders: `${API_BASE}/public/orders`,
  images: `${API_BASE}/images`,
  files: `${API_BASE}/files`,
  dbConfig: `${API_BASE}/db/config`,
  dbTables: `${API_BASE}/db/tables`,
} as const;

/**
 * Roles allowed to touch integrations (payment/email credentials): the
 * install's `owner` plus `admin` for when member accounts arrive. Everything
 * else is refused at the API with 403 — credentials routes are deliberately
 * stricter than the products/sales-pages "any signed-in account" convention.
 */
export const ADMIN_ROLES = ["owner", "admin"] as const;

export function isAdminRole(role: string): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}
