import { z } from "zod";
import { countryByCode } from "./countries";
import { unknownTemplatePlaceholders } from "./emailTemplates";
import { isReservedSlug } from "./routing";

/** Trimmed, lowercased, plausible-email check. One source of truth for API + forms. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Email is required")
  .max(254, "Email is too long")
  .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
    message: "Enter a valid email address",
  });

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");

export const signupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(80, "Name must be at most 80 characters"),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required").max(128),
});

/** Product creation: name + type only; price/stock start at 0. */
export const createProductSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Give the product a name")
    .max(120, "Product name is too long"),
  type: z.enum(["physical", "digital"]),
});

/** Price ceiling in cents (RM 999,999.99) — shared by API and form. */
export const PRODUCT_PRICE_MAX_CENTS = 99_999_999;

/** Whole units of stock — deliberately generous, never negative. */
export const PRODUCT_STOCK_MAX = 999_999;

/** One product's gallery cap — the form's picker and the API agree on it. */
export const GALLERY_LIMIT = 10;

/**
 * Stored image path in R2: `products/<prd-uuid>/<uuid>.<ext>`. The upload
 * endpoint mints these; PATCH only ever re-saves paths it was handed, so the
 * regex is the guard that keeps arbitrary strings out of the DB.
 */
export const IMAGE_PATH_PATTERN =
  /^products\/prd[-_][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f-]{36}\.(webp|png|jpg|jpeg)$/;

export const imagePathSchema = z
  .string()
  .trim()
  .max(300, "Image path is too long")
  .regex(IMAGE_PATH_PATTERN, "That image path doesn't look right");

/** One product's download-file cap — the form's picker and the API agree on it. */
export const DOWNLOAD_FILES_LIMIT = 10;

/** Hard per-file ceiling the upload endpoint enforces. */
export const DOWNLOAD_FILE_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Stored download path in R2: `downloads/<prd-uuid>/<sha256>.<ext>` — content
 * addressed, so identical bytes always land on the same key and the bucket
 * never holds two copies. PATCH only re-saves paths upload handed out.
 */
export const FILE_PATH_PATTERN =
  /^downloads\/prd[-_][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{64}(\.[a-z0-9]{1,12})?$/;

export const filePathSchema = z
  .string()
  .trim()
  .max(300, "File path is too long")
  .regex(FILE_PATH_PATTERN, "That file path doesn't look right");

/** A stored digital file: path to the bytes, plus display name and size. */
export const downloadFileSchema = z.object({
  path: filePathSchema,
  name: z
    .string()
    .trim()
    .min(1, "File name is required")
    .max(200, "File name is too long"),
  size: z
    .number()
    .int("Size must be in bytes")
    .min(0, "Size cannot be negative")
    .max(DOWNLOAD_FILE_MAX_BYTES, "That file is too large"),
});

/** Fulfilment channels: both may be on, but at least one must stay on. */
export const fulfilmentSchema = z
  .object({
    shipment: z.boolean(),
    download: z.boolean(),
  })
  .refine((value) => value.shipment || value.download, {
    message: "Keep at least one fulfilment option on",
  });

/**
 * Product edit: any subset of the editable fields, at least one required.
 * Price/discount arrive in cents (integer money); status flips the draft/active
 * pill. Weight/dimensions are plain numbers (kg / cm) and may be cleared to
 * null; discountPrice may be null (no sale) and must undercut the price when
 * both travel together.
 */
export const updateProductSchema = createProductSchema
  .extend({
    description: z.string().trim().max(5000, "Description is too long").optional(),
    sku: z.string().trim().max(64, "SKU must be at most 64 characters").optional(),
    stock: z
      .number()
      .int("Stock must be whole units")
      .min(0, "Stock cannot be negative")
      .max(PRODUCT_STOCK_MAX, "Stock is too high")
      .optional(),
    price: z
      .number()
      .int("Price must be in cents")
      .min(0, "Price cannot be negative")
      .max(PRODUCT_PRICE_MAX_CENTS, "Price is too high")
      .optional(),
    discountPrice: z
      .number()
      .int("Discount price must be in cents")
      .min(0, "Discount price cannot be negative")
      .max(PRODUCT_PRICE_MAX_CENTS, "Discount price is too high")
      .nullable()
      .optional(),
    status: z.enum(["active", "draft"]).optional(),
    weightKg: z
      .number()
      .min(0, "Weight cannot be negative")
      .max(100_000, "Weight is too high")
      .nullable()
      .optional(),
    widthCm: z
      .number()
      .min(0, "Width cannot be negative")
      .max(10_000, "Width is too large")
      .nullable()
      .optional(),
    heightCm: z
      .number()
      .min(0, "Height cannot be negative")
      .max(10_000, "Height is too large")
      .nullable()
      .optional(),
    lengthCm: z
      .number()
      .min(0, "Length cannot be negative")
      .max(10_000, "Length is too large")
      .nullable()
      .optional(),
    downloadLinks: z
      .array(z.string().trim().max(500, "Link is too long"))
      .max(10, "Up to 10 links")
      .refine(
        (links) => links.every((link) => link === "" || /^https?:\/\/\S+$/.test(link)),
        { message: "Links need the full address, e.g. https://…" },
      )
      .optional(),
    downloadFiles: z
      .array(downloadFileSchema)
      .max(DOWNLOAD_FILES_LIMIT, `Up to ${DOWNLOAD_FILES_LIMIT} files`)
      .refine(
        (list) => new Set(list.map((file) => file.path)).size === list.length,
        { message: "That file is already in the list" },
      )
      .optional(),
    fulfilment: fulfilmentSchema.optional(),
    featured: imagePathSchema.nullable().optional(),
    gallery: z
      .array(imagePathSchema)
      .max(GALLERY_LIMIT, `Up to ${GALLERY_LIMIT} gallery images`)
      .optional(),
  })
  .partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Nothing to update",
  })
  .refine(
    (value) =>
      value.discountPrice == null ||
      value.price === undefined ||
      value.discountPrice < value.price,
    {
      message: "Discount price must be lower than the price",
      path: ["discountPrice"],
    },
  );

/* ------------------------- Sales Pages ------------------------- */

/** Sales page uuid shape (`spg-` + UUIDv7), as minted by entityUuid. */
export const SALESPAGE_UUID_PATTERN =
  /^spg[-_][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Stored HTML path in R2: `salespages/<spg-uuid>/<slot>.html` — one fixed key
 * per page + slot, so a save overwrites in place and the path recorded on the
 * row never changes. `page` is the rendered public document served at
 * `/<slug>`; the other three are the editor slots.
 */
export const SALESPAGE_HTML_PATH_PATTERN =
  /^salespages\/spg[-_][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(component|code|ai|page)\.html$/;

/**
 * Hard ceiling for one stored HTML document — mirrors the importer's
 * document cap (import.service), so anything importable is storable.
 */
export const SALESPAGE_HTML_MAX_BYTES = 3_000_000;

export const salesPageHtmlSlotSchema = z.enum(["component", "code", "ai"]);

export const salesPageStatusSchema = z.enum(["open", "closed"]);

/** URL segment, lowercased kebab — the public `/<slug>` key. */
export const salesPageSlugSchema = z
  .string()
  .trim()
  .min(1, "Give the page a slug")
  .max(80, "Slug must be at most 80 characters")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and dashes")
  // The root namespace is shared with the app's own routes, so a slug like
  // `login` would sit behind a shell that never renders it. Blocked on both
  // create and PATCH — see RESERVED_SLUGS for the list and why.
  .refine((slug) => !isReservedSlug(slug), "That address belongs to the app — pick another");

/**
 * UTF-8 byte length (not UTF-16 units) — the ceiling the R2 write enforces
 * too. Hand-counted so shared stays runtime-neutral (no TextEncoder types).
 * Over-counts a lone surrogate by one, i.e. never permissive.
 */
function utf8Bytes(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      bytes += 4; // surrogate pair = one 4-byte code point
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

/** SEO block copied into the page `<head>` (title / description / keywords). */
export const salesPageSeoSchema = z.object({
  title: z.string().max(200, "SEO title is too long"),
  description: z.string().max(500, "SEO description is too long"),
  keywords: z.string().max(300, "SEO keywords are too long"),
});

/** Open Graph block for social share cards. */
export const salesPageOgSchema = z.object({
  title: z.string().max(200, "OG title is too long"),
  description: z.string().max(500, "OG description is too long"),
  image: z.string().max(2048, "OG image address is too long"),
});

/**
 * Component-canvas sections stay opaque here (objects of anything) — the SPA
 * owns their schema; the API only bounds their count and shape.
 */
const sectionsSchema = z
  .array(z.record(z.string(), z.unknown()))
  .max(64, "Up to 64 sections");

/** Visual theme (fonts, colors, spacing, icons) — opaque, SPA-owned shape. */
const styleSchema = z.record(z.string(), z.unknown());

/** `prd-…` product ids the checkout block sells, in listing order. */
const checkoutProductsSchema = z
  .array(
    z
      .string()
      .trim()
      .regex(
        /^prd[-_][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        "That product id doesn't look right",
      ),
  )
  .max(10, "Up to 10 checkout products");

/** `itg-…` integration uuid — the shape every checkout pointer uses. */
const integrationUuidSchema = z
  .string()
  .trim()
  .regex(
    /^itg[-_][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    "That integration id doesn't look right",
  );

/** The checkout's payment gateway, or none. */
export const paymentGatewaySchema = integrationUuidSchema.nullable();

/** The checkout's email sender (an Email-category integration), or none. */
export const emailSenderSchema = integrationUuidSchema.nullable();

/** Tracking integrations the page reports to, in the order they were added. */
export const trackingsSchema = z
  .array(integrationUuidSchema)
  .max(5, "Up to 5 tracking integrations");

/** Capped HTML string: the same 3 MB ceiling on every stored document. */
const storedHtmlDocumentSchema = z
  .string()
  .refine((value) => utf8Bytes(value) <= SALESPAGE_HTML_MAX_BYTES, {
    message: "That HTML document is too large (max 3 MB)",
  });

/**
 * Flat shipping charged by the checkout block when the cart holds a physical
 * item — faked for this milestone (cents, like every price). One shared
 * constant so the document's script, the editor preview and the order
 * service can never disagree about the total.
 */
export const ORDER_SHIPPING_CENTS = 1000;

/** One cart line an order may carry: a product and a whole-unit quantity. */
export const orderItemSchema = z.object({
  product: z
    .string()
    .trim()
    .regex(
      /^prd[-_][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      "That product id doesn't look right",
    ),
  qty: z.number().int("Quantity must be whole units").min(1).max(20, "Up to 20 per item"),
});

/** Buyer details collected by the checkout block's form. */
export const orderCustomerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Give the buyer's name")
    .max(120, "Name is too long"),
  phone: z.string().trim().min(5, "Give a phone number").max(40, "Phone is too long"),
  email: z
    .string()
    .trim()
    .max(200, "Email is too long")
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Enter a valid email"),
  // Shipping details: required by the service when anything ships.
  address: z.string().trim().max(300, "Address is too long").optional(),
  postcode: z.string().trim().max(12, "Postcode is too long").optional(),
  city: z.string().trim().max(120, "City is too long").optional(),
  state: z.string().trim().max(120, "State is too long").optional(),
  /** Destination country (ISO alpha-2) — required when anything ships. */
  country: z
    .string()
    .trim()
    .toUpperCase()
    .refine((code) => countryByCode(code) !== null, "Choose a valid country")
    .optional(),
});

/**
 * When the buyer reached the page and first added something to the cart — the
 * first two timeline beats. Captured in the browser (session storage) and sent
 * with the checkout; the service sanitises them before storing.
 */
export const orderEventsSchema = z.object({
  visitedAt: z.string().trim().max(40).optional(),
  addedAt: z.string().trim().max(40).optional(),
});

/**
 * POST /api/public/orders — the checkout block's submit, signed out. The
 * client's `totalCents` is a consistency check only: the service recomputes
 * every price from its own rows and 409s when they disagree.
 */
export const createOrderSchema = z.object({
  slug: salesPageSlugSchema,
  items: z.array(orderItemSchema).min(1, "Your cart is empty").max(30, "Too many items"),
  customer: orderCustomerSchema,
  totalCents: z.number().int().min(0).max(100_000_000),
  events: orderEventsSchema.optional(),
});

/** PATCH /api/orders/:uuid/fulfilment — the merchant's shipping progress. */
/**
 * Editing an automated email. Subject and message stay plain text; every
 * `{token}` must be one the template understands, so a typo is caught here
 * instead of reaching a buyer as literal braces.
 */
export const updateEmailTemplateSchema = z
  .object({
    subject: z
      .string()
      .trim()
      .min(1, "Subject is required")
      .max(200, "Subject must be at most 200 characters"),
    body: z
      .string()
      .trim()
      .min(1, "Message is required")
      .max(20_000, "Message must be at most 20000 characters"),
  })
  .superRefine((value, ctx) => {
    for (const field of ["subject", "body"] as const) {
      const unknown = unknownTemplatePlaceholders(value[field]);
      if (unknown.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `Unknown placeholder${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`,
        });
      }
    }
  });

export type UpdateEmailTemplateInput = z.infer<typeof updateEmailTemplateSchema>;

export const updateOrderFulfilmentSchema = z.object({
  status: z.enum(["unfulfilled", "fulfilled", "delivered"]),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type OrderItemInput = z.infer<typeof orderItemSchema>;

/**
 * Admin test checkout: pretend the gateway came back with one of these three
 * results. The order is flagged `test` so the merchant list can say so.
 */
export const testOrderOutcomeSchema = z.object({
  outcome: z.enum(["success", "failed", "cancel"]),
});

export type TestOrderOutcome = z.infer<typeof testOrderOutcomeSchema>["outcome"];

/**
 * Page creation: name + slug (+ optional products and editor type). Slugs are
 * never auto-suffixed — a taken slug is a 409 the form shows inline.
 */
export const createSalesPageSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Give the page a name")
    .max(120, "Page name is too long"),
  slug: salesPageSlugSchema,
  /** Editor type the page opens in; defaults to the Import Editor ("code"). */
  htmlType: salesPageHtmlSlotSchema.optional(),
  /** Products the checkout block sells; empty by default. */
  products: checkoutProductsSchema.optional(),
  /**
   * The rendered public document (`/<slug>`) as one standalone HTML file,
   * stored in R2 at create so the address works before the first edit.
   * Built by the SPA — it owns the renderer and the styles.
   */
  document: storedHtmlDocumentSchema.optional(),
});

/**
 * Page edit: any subset of the editable fields. `html` writes/clears the R2
 * documents — a slot string stores the file and records its path, `null`
 * deletes the file and drops the path, an omitted slot is untouched. Visits
 * deliberately has no field: the counter is machine-managed.
 */
export const updateSalesPageSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Give the page a name")
      .max(120, "Page name is too long")
      .optional(),
    slug: salesPageSlugSchema.optional(),
    status: salesPageStatusSchema.optional(),
    htmlType: salesPageHtmlSlotSchema.optional(),
    seo: salesPageSeoSchema.optional(),
    og: salesPageOgSchema.optional(),
    sections: sectionsSchema.optional(),
    style: styleSchema.optional(),
    checkoutProducts: checkoutProductsSchema.optional(),
    paymentGateway: paymentGatewaySchema.optional(),
    emailSender: emailSenderSchema.optional(),
    trackings: trackingsSchema.optional(),
    // Snapshot provenance clears as explicitly as it sets: `null` drops the
    // fields (the editor's Reset), an omitted key leaves them untouched.
    htmlMode: z.enum(["snapshot"]).nullable().optional(),
    source: z
      .object({
        url: z.string().max(2048, "Source address is too long"),
        importedAt: z.string().max(40),
      })
      .nullable()
      .optional(),
    html: z
      .partialRecord(
        salesPageHtmlSlotSchema,
        z
          .string()
          .refine((value) => utf8Bytes(value) <= SALESPAGE_HTML_MAX_BYTES, {
            message: "That HTML document is too large (max 3 MB)",
          })
          .nullable(),
      )
      .optional(),
    // The rendered public document follows the html-slot rule: a string
    // stores the file, `null` deletes it, omitted leaves it untouched.
    document: storedHtmlDocumentSchema.nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Nothing to update",
  });

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type CreateSalesPageInput = z.infer<typeof createSalesPageSchema>;
export type UpdateSalesPageInput = z.infer<typeof updateSalesPageSchema>;
export type SalesPageHtmlSlot = z.infer<typeof salesPageHtmlSlotSchema>;
export type SalesPageStatus = z.infer<typeof salesPageStatusSchema>;

/**
 * The URL importer: the SPA asks the Worker to fetch one remote resource —
 * the page itself or one of its stylesheets — because the browser can't do
 * that cross-origin. The address (and every redirect hop) is re-validated
 * against the SSRF gate server-side before a byte is fetched.
 */
export const IMPORT_KINDS = ["document", "stylesheet"] as const;

export const importFetchQuerySchema = z.object({
  url: z.string().min(1, "Give the full address").max(2048, "That address is too long"),
  kind: z.enum(IMPORT_KINDS),
});

export type ImportKind = z.infer<typeof importFetchQuerySchema>["kind"];
