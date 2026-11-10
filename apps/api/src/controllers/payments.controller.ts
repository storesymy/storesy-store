import { isAdminRole, testOrderOutcomeSchema } from "@storesy/shared";
import type { Context } from "../core/context";
import { forbidden, unauthorized } from "../core/errors";
import * as auth from "../services/auth.service";
import * as notifications from "../services/notifications.service";
import * as payments from "../services/payments.service";
import { enforceRateLimit } from "../services/rate-limit.service";

/**
 * The buyer's payment journey, all signed out: start a gateway payment, come
 * back from it, read the receipt, and take the gateway's server-to-server
 * "paid" notification. None of these answer JSON to a browser except `start`
 * (the checkout script calls it).
 */

/**
 * Starting a payment mints a gateway bill. A real buyer does it once; a
 * retry after a 409 or a dropped response still fits easily. Counted per IP
 * like the order endpoint.
 */
const PAY_START_LIMIT = 30;
const PAY_START_WINDOW_MS = 60 * 60 * 1000;

function htmlDocument(ctx: Context, body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Request-Id": ctx.requestId,
    },
  });
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}

const NOT_FOUND_DOCUMENT =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  "<title>Order not found · Storesy</title></head><body " +
  'style="font-family:system-ui,sans-serif;margin:0;padding:48px 24px;' +
  'text-align:center;color:#14181F;background:#fff">' +
  '<h1 style="font-size:28px;margin:0 0 8px">Order not found</h1>' +
  '<p style="margin:0;color:#5B6472">We couldn\'t find that order.</p></body></html>';

/**
 * POST /api/public/orders/:uuid/pay — create (or reuse) the gateway bill and
 * return its hosted URL. The checkout script redirects the browser there.
 */
export async function start(ctx: Context): Promise<Response> {
  await enforceRateLimit(
    ctx.env,
    `pay:${ctx.clientIp}`,
    PAY_START_LIMIT,
    PAY_START_WINDOW_MS,
    "Too many payment attempts — please try again in a few minutes.",
  );
  const result = await payments.start(ctx.env, ctx.params.uuid ?? "", ctx.url.origin);
  return ctx.json(result);
}

/**
 * GET /:slug/payment-return/:uuid — where the gateway sends the browser back.
 * Success lands on the receipt; anything else returns to the page with
 * `?payment=failed` (or `pending` when the gateway couldn't be asked).
 */
export async function returnFromGateway(ctx: Context): Promise<Response> {
  const location = await payments.completeReturn(ctx.env, ctx.params.uuid ?? "");
  if (!location) return htmlDocument(ctx, NOT_FOUND_DOCUMENT, 404);
  // Only sends when the return actually flipped the order to paid; the service
  // checks that and the per-order sent markers, so a duplicate is a no-op.
  ctx.waitUntil(notifications.notifyOrderPaid(ctx.env, ctx.params.uuid ?? "", ctx.url.origin));
  return redirect(location);
}

/** GET /:slug/thank-you/:uuid — the receipt, paid orders only. */
export async function thankYou(ctx: Context): Promise<Response> {
  const result = await payments.thankYou(ctx.env, ctx.params.uuid ?? "");
  if (!result) return htmlDocument(ctx, NOT_FOUND_DOCUMENT, 404);
  if ("redirect" in result) return redirect(result.redirect);
  return htmlDocument(ctx, result.body);
}

/**
 * POST /api/orders/:uuid/test — the checkout's admin test controls. Simulates
 * the gateway result for this order (marked `test`), so the whole buyer flow
 * can be walked without credentials or money. ADMIN-ONLY: 401 signed out, 403
 * outside ADMIN_ROLES — a buyer cannot conjure a paid order.
 */
export async function simulate(ctx: Context): Promise<Response> {
  if (!ctx.session) throw unauthorized();
  const user = await auth.userById(ctx.env, ctx.session.userId);
  if (!user || !isAdminRole(user.role)) throw forbidden("forbidden", "Admin access required");
  const input = await ctx.body(testOrderOutcomeSchema);
  const result = await payments.simulate(ctx.env, ctx.params.uuid ?? "", input.outcome);
  if (input.outcome === "success") {
    // Same notifications the real success path sends, marked [TEST].
    ctx.waitUntil(notifications.notifyOrderPaid(ctx.env, ctx.params.uuid ?? "", ctx.url.origin));
  }
  return ctx.json(result);
}

/**
 * POST /api/public/payments/billplz/callback/:uuid — Billplz's notification.
 * The payload is a hint; the service re-reads the bill with the merchant's key
 * before anything is marked paid. Always 200 so retries stop (the return trip
 * is the buyer-facing source of truth).
 */
export async function billplzCallback(ctx: Context): Promise<Response> {
  await payments.billplzCallback(ctx.env, ctx.params.uuid ?? "");
  ctx.waitUntil(notifications.notifyOrderPaid(ctx.env, ctx.params.uuid ?? "", ctx.url.origin));
  return new Response("OK", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
