import * as auth from "./controllers/auth.controller";
import * as customers from "./controllers/customers.controller";
import * as db from "./controllers/db.controller";
import * as emailTemplates from "./controllers/emailTemplates.controller";
import * as downloads from "./controllers/downloads.controller";
import * as files from "./controllers/files.controller";
import * as health from "./controllers/health.controller";
import * as images from "./controllers/images.controller";
import * as importer from "./controllers/import.controller";
import * as integrations from "./controllers/integrations.controller";
import * as orders from "./controllers/orders.controller";
import * as payments from "./controllers/payments.controller";
import * as products from "./controllers/products.controller";
import * as salespages from "./controllers/salespages.controller";
import * as shippingZones from "./controllers/shippingZones.controller";
import * as users from "./controllers/users.controller";
import type { MenuKey } from "@storesy/shared";
import type { Handler } from "./core/router";
import { Router } from "./core/router";
import * as permissions from "./services/permissions.service";

/** Gate a route by the sidebar menu it backs (owner bypasses). */
function menu(key: MenuKey, handler: Handler): Handler {
  return async (ctx) => {
    await permissions.requireMenu(ctx, key);
    return handler(ctx);
  };
}

export function buildRouter(): Router {
  return new Router()
    .get("/api/health", health.health)
    .get("/api/auth/signup-status", auth.signupStatus)
    .post("/api/auth/signup", auth.signup)
    .post("/api/auth/login", auth.login)
    .post("/api/auth/logout", auth.logout)
    .get("/api/me", auth.me)
    // Invitations: the invitee's public confirmation/acceptance, plus the
    // admin-only creation path.
    .get("/api/invitations/:token", users.invitation)
    .post("/api/invitations/:token/accept", users.accept)
    .post("/api/invitations", users.invite)
    // User management (admin/owner only; the service keeps owner protected).
    .get("/api/users", users.list)
    .patch("/api/users/:uuid", users.update)
    .post("/api/users/:uuid/resend-invite", users.resend)
    .delete("/api/users/:uuid", users.revoke)
    // Products — any signed-in account (401 without a session, never owner-only).
    .get("/api/products", menu("products", products.list))
    .get("/api/products/:uuid", menu("products", products.detail))
    .post("/api/products", menu("products", products.create))
    .patch("/api/products/:uuid", menu("products", products.update))
    // Shipping Zone — delivery rates. Session-gated like products; no
    // credentials live here, so every signed-in role may manage them.
    .get("/api/shipping-zones", menu("shipping-zone", shippingZones.list))
    .get("/api/shipping-zones/:uuid", menu("shipping-zone", shippingZones.detail))
    .post("/api/shipping-zones", menu("shipping-zone", shippingZones.create))
    .patch("/api/shipping-zones/:uuid", menu("shipping-zone", shippingZones.update))
    .delete("/api/shipping-zones/:uuid", menu("shipping-zone", shippingZones.remove))
    // Sales pages — any signed-in account, like products. Documents live in
    // R2; the row records their paths. The public read is the signed-out
    // storefront view (`/<slug>`), and it counts views via the counter DO.
    .get("/api/salespages", menu("salespages", salespages.list))
    .get("/api/salespages/public/:slug", salespages.publicRead)
    .get("/api/salespages/:uuid", menu("salespages", salespages.detail))
    .post("/api/salespages", menu("salespages", salespages.create))
    .patch("/api/salespages/:uuid", menu("salespages", salespages.update))
    .delete("/api/salespages/:uuid", menu("salespages", salespages.remove))
    // The checkout's rate card — signed out, like the page that reads it.
    // Keys and amounts only; no merchant labels or account data.
    .get("/api/public/shipping-rates", shippingZones.publicRates)
    // The checkout's live quote — flat rates or a MyParcel Asia query,
    // resolved server-side from the buyer's allowlisted cart.
    .post("/api/public/shipping-quote", shippingZones.quote)
    // Orders — the public submit is the app's only signed-out write (the
    // checkout block on `/<slug>`; rate-limited per IP, every price
    // revalidated server-side); the list is a plain session read.
    .post("/api/public/orders", orders.create)
    // Payments — start the gateway payment for an order, then take the
    // gateway's browser return and its server-to-server callback. The receipt
    // lives at `/:slug/thank-you/:uuid` below.
    .post("/api/public/orders/:uuid/pay", payments.start)
    .post("/api/public/payments/billplz/callback/:uuid", payments.billplzCallback)
    // Paid-order downloads from the thank-you email: the order id is the
    // capability, and the service requires a paid order that contains the
    // product. Digital goods never become publicly browsable.
    .get("/api/public/downloads/:order/:product/:index", downloads.serve)
    .get("/api/orders", menu("orders", orders.list))
    // The sidebar badge: paid orders still to fulfil (cheap count, no joins).
    // Deliberately session-only so every Shell can render the badge.
    .get("/api/orders/summary", orders.summary)
    // The /fulfilment table: the same filter with the full list shape.
    .get("/api/orders/to-process", menu("fulfilment", orders.toProcess))
    // AWB booking for the selected fulfilled queue (real MyParcel Asia labels).
    .post("/api/fulfilment/awb", menu("fulfilment", orders.generateAwb))
    // The batches created by successful AWB runs.
    .get("/api/fulfilment/batches", menu("fulfilment", orders.listBatches))
    // One combined MyParcel Asia consignment-note PDF for the batch.
    .get(
      "/api/fulfilment/batches/:uuid/print_label",
      menu("fulfilment", orders.printBatchLabel),
    )
    // One order's detail, and the merchant's fulfilment action.
    .get("/api/orders/:uuid", menu("orders", orders.detail))
    .patch("/api/orders/:uuid/fulfilment", menu("orders", orders.fulfilment))
    // Customers — the merchant's list (search + 30/page). Session-gated.
    .get("/api/customers", menu("customers", customers.list))
    .get("/api/customers/:uuid", menu("customers", customers.detail))
    // Email templates — the automated messages the store sends.
    .get("/api/templates", menu("templates", emailTemplates.list))
    .patch("/api/templates/:uuid", menu("templates", emailTemplates.update))
    // The checkout's admin test controls (Success / Failed / Cancel) — the
    // only order write that isn't the buyer's own submit, and admin-gated.
    .post("/api/orders/:uuid/test", payments.simulate)
    // Integrations — the first ADMIN-ONLY surface: credentials for payment
    // and email providers (401 without a session, 403 outside ADMIN_ROLES),
    // and every read carries masked hints only, never a secret.
    .get("/api/integrations", menu("integrations", integrations.list))
    .post("/api/integrations", menu("integrations", integrations.create))
    // Gmail OAuth handshake. The callback is a browser navigation (Google →
    // us), so it answers with an HTML redirect page instead of JSON; the
    // pending pointer lives in an HttpOnly cookie, never in a URL.
    .post("/api/integrations/gmail/oauth/start", menu("integrations", integrations.gmailStart))
    .get("/api/integrations/gmail/oauth/callback", integrations.gmailCallback)
    .get("/api/integrations/gmail/oauth/pending", menu("integrations", integrations.gmailPending))
    .post("/api/integrations/gmail/oauth/complete", menu("integrations", integrations.gmailComplete))
    .delete("/api/integrations/gmail/oauth/pending", menu("integrations", integrations.gmailDiscard))
    .patch("/api/integrations/:uuid", menu("integrations", integrations.update))
    .delete("/api/integrations/:uuid", menu("integrations", integrations.remove))
    // Setup check for MyParcel Asia (admin-only): decrypts the stored key and
    // asks for one sample quote — no secret ever leaves the server.
    .post("/api/integrations/:uuid/verify", menu("integrations", integrations.verify))
    // Test Email — admin-only; sends to the SESSION user (Cloudflare only).
    .post("/api/integrations/:uuid/test-email", menu("integrations", integrations.testEmail))
    // Images — upload is a session-gated write; reads are public (the
    // storefront views product pictures signed out).
    .post("/api/images", images.upload)
    .get("/api/images/*", images.serve)
    // URL importer — the SPA's cross-origin fetch proxy: session-gated and
    // rate-limited here, size-capped and SSRF-gated in the service.
    .get("/api/import/fetch", importer.fetchRemote)
    // Digital files — upload is a session-gated write; reads stay signed-in
    // only (paid goods never go public).
    .post("/api/files", files.upload)
    .get("/api/files/*", files.serve)
    // /system — read-only database viewer (owner-only, guarded in the controller).
    .get("/api/db/config", db.config)
    .get("/api/db/tables", db.tables)
    .get("/api/db/tables/:table/structure", db.structure)
    .get("/api/db/tables/:table/data", db.data)
    // The public storefront document — plain HTML, not JSON: the standalone
    // document stored in R2 at save time. Signed out, like the JSON read.
    // Registered after every /api route and before the catch-all: one segment
    // long, so it can't shadow them, and a real slug must always win over the
    // tombstone below.
    .get("/:slug", salespages.publicPage)
    // The checkout's two extra pages: the gateway's return trip and the
    // receipt. Both are three segments, so they never shadow `/:slug`.
    .get("/:slug/payment-return/:uuid", payments.returnFromGateway)
    .get("/:slug/thank-you/:uuid", payments.thankYou)
    // Everything else the edge hands over — retired `/p/<slug>` links from the
    // old address shape, typo'd deep paths — answered as a branded document
    // 404, never JSON, except where the API prefix owns the namespace.
    .get("/*", salespages.gone);
}
