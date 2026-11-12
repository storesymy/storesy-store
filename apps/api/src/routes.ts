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
import { Router } from "./core/router";

export function buildRouter(): Router {
  return new Router()
    .get("/api/health", health.health)
    .post("/api/auth/signup", auth.signup)
    .post("/api/auth/login", auth.login)
    .post("/api/auth/logout", auth.logout)
    .get("/api/me", auth.me)
    // Products — any signed-in account (401 without a session, never owner-only).
    .get("/api/products", products.list)
    .get("/api/products/:uuid", products.detail)
    .post("/api/products", products.create)
    .patch("/api/products/:uuid", products.update)
    // Sales pages — any signed-in account, like products. Documents live in
    // R2; the row records their paths. The public read is the signed-out
    // storefront view (`/<slug>`), and it counts views via the counter DO.
    .get("/api/salespages", salespages.list)
    .get("/api/salespages/public/:slug", salespages.publicRead)
    .get("/api/salespages/:uuid", salespages.detail)
    .post("/api/salespages", salespages.create)
    .patch("/api/salespages/:uuid", salespages.update)
    .delete("/api/salespages/:uuid", salespages.remove)
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
    .get("/api/orders", orders.list)
    // One order's detail, and the merchant's fulfilment action.
    .get("/api/orders/:uuid", orders.detail)
    .patch("/api/orders/:uuid/fulfilment", orders.fulfilment)
    // Customers — the merchant's list (search + 30/page). Session-gated.
    .get("/api/customers", customers.list)
    .get("/api/customers/:uuid", customers.detail)
    // Email templates — the automated messages the store sends. Any signed-in
    // account may read and edit the wording (no credentials live here).
    .get("/api/templates", emailTemplates.list)
    .patch("/api/templates/:uuid", emailTemplates.update)
    // The checkout's admin test controls (Success / Failed / Cancel) — the
    // only order write that isn't the buyer's own submit, and admin-gated.
    .post("/api/orders/:uuid/test", payments.simulate)
    // Integrations — the first ADMIN-ONLY surface: credentials for payment
    // and email providers (401 without a session, 403 outside ADMIN_ROLES),
    // and every read carries masked hints only, never a secret.
    .get("/api/integrations", integrations.list)
    .post("/api/integrations", integrations.create)
    // Gmail OAuth handshake. The callback is a browser navigation (Google →
    // us), so it answers with an HTML redirect page instead of JSON; the
    // pending pointer lives in an HttpOnly cookie, never in a URL.
    .post("/api/integrations/gmail/oauth/start", integrations.gmailStart)
    .get("/api/integrations/gmail/oauth/callback", integrations.gmailCallback)
    .get("/api/integrations/gmail/oauth/pending", integrations.gmailPending)
    .post("/api/integrations/gmail/oauth/complete", integrations.gmailComplete)
    .delete("/api/integrations/gmail/oauth/pending", integrations.gmailDiscard)
    .patch("/api/integrations/:uuid", integrations.update)
    .delete("/api/integrations/:uuid", integrations.remove)
    // Test Email — admin-only; sends to the SESSION user (Cloudflare only).
    .post("/api/integrations/:uuid/test-email", integrations.testEmail)
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
