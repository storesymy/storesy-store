import { formatOrderNo } from "@storesy/shared";
import type { TestOrderOutcome } from "@storesy/shared";
import { conflict, notFound } from "../core/errors";
import type { OrderData, SalesPageData } from "../models/schema";
import * as customersRepo from "../models/customers.repository";
import * as integrationsRepo from "../models/integrations.repository";
import * as ordersRepo from "../models/orders.repository";
import * as salespagesModel from "../models/salespages.repository";
import { decryptSecret, fieldAad } from "./integrations.crypto";
import { GatewayError, createBill, getBill } from "./payments/billplz";
import type { BillplzCredentials } from "./payments/billplz";
import { klNow } from "./time";

/**
 * Payments — the buyer-facing half of the checkout. The block on `/<slug>`
 * creates the order (orders.service owns every price), then asks:
 *
 *   POST /api/public/orders/:uuid/pay   →  { url }   (the gateway's page)
 *   GET  /:slug/payment-return/:uuid    →  302 thank-you, or back with `?payment=failed`
 *   GET  /:slug/thank-you/:uuid         →  the receipt page (paid orders only)
 *   POST /api/public/payments/billplz/callback/:uuid  →  server-to-server "paid"
 *
 * The gateway's word is never trusted blind: the return trip and the callback
 * both re-read the bill with the merchant's own secret key and compare the
 * amount to the order's total before flipping `status` to `paid`.
 */

/**
 * One message for every "this page can't take money" shape: no gateway picked,
 * a deleted gateway row, a provider we can't drive yet. The buyer can only act
 * on "contact the store"; the specific cause is logged for the merchant.
 */
const NOT_SET_UP = "This page isn't set up to accept payments yet — please contact the store.";
const GATEWAY_TROUBLE = "We couldn't start the payment — please try again in a moment.";

export interface StartPayment {
  /** The gateway's hosted payment page. The browser goes here. */
  url: string;
}

/** The gateway credentials for one integration row, decrypted on demand. */
async function credentialsOf(env: Env, integrationUuid: string): Promise<BillplzCredentials | null> {
  const row = await integrationsRepo.findIntegration(env, integrationUuid);
  if (!row || row.provider !== "billplz") return null;
  const envelope = row.data.secrets.apiKey;
  if (!envelope) return null;
  const apiKey = await decryptSecret(env, fieldAad(row.uuid, "apiKey"), envelope);
  return {
    host: row.data.settings.host ?? "billplz.com",
    apiKey,
    collectionId: row.data.settings.collectionId ?? "",
  };
}

/**
 * Send the buyer to the gateway: create the bill for the order's truthful
 * total and the buyer's own email, remember the bill id on the order, and
 * hand back the hosted URL.
 *
 * Idempotent per order: a second click (or a retry after a dropped response)
 * reuses the bill already created instead of minting a duplicate.
 */
export async function start(
  env: Env,
  orderUuid: string,
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StartPayment> {
  const found = await ordersRepo.findOrderByUuid(env, orderUuid);
  if (!found) throw notFound("order_not_found", "No order with that id");
  const order = found.order;
  const data = order.data as OrderData;

  if (order.status === "paid") {
    throw conflict("order_already_paid", "This order has already been paid");
  }
  // A previous visit already minted a bill — send the buyer back to it.
  if (data.payment?.url) return { url: data.payment.url };

  if (!found.pageSlug) throw conflict("payment_unavailable", NOT_SET_UP);
  const page = await salespagesModel.findSalesPageBySlug(env, found.pageSlug);
  if (!page) throw conflict("payment_unavailable", NOT_SET_UP);
  const pageData = page.data as SalesPageData;

  const gatewayUuid = pageData.paymentGateway;
  if (!gatewayUuid) throw conflict("payment_unavailable", NOT_SET_UP);
  const integration = await integrationsRepo.findIntegration(env, gatewayUuid);
  // The pointer is stale (row deleted) — same dead end as no gateway at all.
  if (!integration) throw conflict("payment_unavailable", NOT_SET_UP);
  // CHIP needs a Brand ID the integration doesn't carry yet; only Billplz is
  // wired to the payment flow for now. The buyer's message stays generic.
  if (integration.provider !== "billplz") {
    console.error("payment_provider_unsupported", { order: order.uuid, provider: integration.provider });
    throw conflict("payment_unavailable", NOT_SET_UP);
  }

  const credentials = await credentialsOf(env, integration.uuid);
  if (!credentials || !credentials.collectionId) {
    console.error("payment_provider_incomplete", { order: order.uuid, integration: integration.uuid });
    throw conflict("payment_unavailable", NOT_SET_UP);
  }

  // The buyer lives in `customers`; a missing row means we can't address the
  // bill at all, so this is the same dead end as a page with no gateway.
  const customer = found.customer;
  if (!customer) {
    console.error("payment_customer_missing", { order: order.uuid });
    throw conflict("payment_unavailable", NOT_SET_UP);
  }
  let created: { id: string; url: string };
  try {
    created = await createBill(
      credentials,
      {
        amountCents: data.totalCents,
        email: customer.email,
        name: found.contact?.name || customer.name,
        description: `${found.pageName ?? "Order"} — ${order.uuid}`.slice(0, 200),
        reference: order.uuid,
        callbackUrl: `${origin}/api/public/payments/billplz/callback/${order.uuid}`,
        redirectUrl: `${origin}/${found.pageSlug}/payment-return/${order.uuid}`,
      },
      fetchImpl,
    );
  } catch (error) {
    if (error instanceof GatewayError) {
      console.error("payment_gateway_create_failed", { order: order.uuid, status: error.status, message: error.message });
      throw conflict("gateway_error", GATEWAY_TROUBLE);
    }
    throw error;
  }

  const now = klNow();
  await ordersRepo.updateOrder(env, order.id, {
    data: {
      ...data,
      payment: {
        provider: "billplz",
        integration: integration.uuid,
        reference: created.id,
        url: created.url,
        createdAt: now,
      },
      updatedAt: now,
    },
  });
  return { url: created.url };
}

/**
 * Admin test checkout: pretend the gateway answered. The same order the real
 * checkout would have written is flagged `test`, its status is set to the
 * simulated result, and the caller gets the same redirect the gateway trip
 * would have produced — so the whole buyer experience runs without money or
 * credentials. Refuses to rewrite an order that is already paid.
 */
export async function simulate(
  env: Env,
  orderUuid: string,
  outcome: TestOrderOutcome,
): Promise<{ url: string }> {
  const found = await ordersRepo.findOrderByUuid(env, orderUuid);
  if (!found) throw notFound("order_not_found", "No order with that id");
  if (!found.pageSlug) throw notFound("page_not_found", "This page is no longer available");
  if (found.order.status === "paid") {
    throw conflict("order_already_paid", "This order has already been paid");
  }

  const data = found.order.data as OrderData;
  const now = klNow();
  const status = outcome === "success" ? "paid" : outcome === "failed" ? "failed" : "cancelled";
  await ordersRepo.updateOrder(env, found.order.id, {
    status,
    data: { ...data, test: true, updatedAt: now },
  });
  if (outcome === "success") await refreshCustomer(env, orderUuid, found.order.customerId);

  const url =
    outcome === "success"
      ? `/${found.pageSlug}/thank-you/${orderUuid}`
      : `/${found.pageSlug}?payment=${outcome === "cancel" ? "cancelled" : "failed"}`;
  return { url };
}

/**
 * What the gateway says about this order right now, re-read with the
 * merchant's key. `confirmed: false` means "we couldn't ask" — distinct from
 * "asked, not paid", which must never be treated the same way.
 */
async function verifyPaid(
  env: Env,
  orderUuid: string,
  data: OrderData,
  fetchImpl: typeof fetch,
): Promise<{ paid: boolean; confirmed: boolean }> {
  const payment = data.payment;
  if (!payment) return { paid: false, confirmed: false };

  const credentials = await credentialsOf(env, payment.integration);
  if (!credentials) return { paid: false, confirmed: false };

  try {
    const bill = await getBill(credentials, payment.reference, fetchImpl);
    // Paid AND for exactly this order's money — a shorter bill is not ours.
    return { paid: bill.paid && bill.amountCents === data.totalCents, confirmed: true };
  } catch (error) {
    if (error instanceof GatewayError) {
      console.error("payment_gateway_verify_failed", { order: orderUuid, status: error.status, message: error.message });
      return { paid: false, confirmed: false };
    }
    throw error;
  }
}

/** Flip the order to paid exactly once, keeping the gateway reference. */
async function markPaid(env: Env, orderUuid: string): Promise<void> {
  const found = await ordersRepo.findOrderByUuid(env, orderUuid);
  if (!found || found.order.status === "paid") return;
  const data = found.order.data as OrderData;
  const now = klNow();
  await ordersRepo.updateOrder(env, found.order.id, {
    status: "paid",
    data: {
      ...data,
      ...(data.payment ? { payment: { ...data.payment, paidAt: now } } : {}),
      updatedAt: now,
    },
  });
  await refreshCustomer(env, orderUuid, found.order.customerId);
}

/** Recompute the buyer's LTV/count/last-date; never let it fail a payment. */
async function refreshCustomer(env: Env, orderUuid: string, customerId: number | null): Promise<void> {
  if (customerId === null) return;
  try {
    await customersRepo.recomputeAggregates(env, customerId);
  } catch (error) {
    console.error("customer_aggregates_failed", { order: orderUuid, error: String(error) });
  }
}

/**
 * The buyer is back from the gateway. Confirm with the gateway itself, then
 * either show the receipt or return to the page with the reason attached.
 * Returns the URL to redirect to (the order's CURRENT slug, so a page renamed
 * mid-payment still lands somewhere real), or null when the order is unknown.
 */
export async function completeReturn(
  env: Env,
  orderUuid: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const found = await ordersRepo.findOrderByUuid(env, orderUuid);
  if (!found) return null;
  const slug = found.pageSlug;
  if (!slug) return null;

  const data = found.order.data as OrderData;
  if (found.order.status === "paid") return `/${slug}/thank-you/${orderUuid}`;

  const verdict = await verifyPaid(env, orderUuid, data, fetchImpl);
  if (verdict.paid) {
    await markPaid(env, orderUuid);
    return `/${slug}/thank-you/${orderUuid}`;
  }
  // Unconfirmed (gateway unreachable, credentials rotated): the order stays
  // pending and the buyer is told we haven't confirmed it — never "failed".
  return `/${slug}?payment=${verdict.confirmed ? "failed" : "pending"}`;
}

/** Billplz's server-to-server notification: verify, then flip the order. */
export async function billplzCallback(
  env: Env,
  orderUuid: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const found = await ordersRepo.findOrderByUuid(env, orderUuid);
  if (!found || found.order.status === "paid") return;
  const verdict = await verifyPaid(env, orderUuid, found.order.data as OrderData, fetchImpl);
  if (verdict.paid) await markPaid(env, orderUuid);
}

/** Minimal HTML escaping — buyer names and product names reach the markup. */
function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function money(cents: number): string {
  return `RM${(cents / 100).toFixed(2)}`;
}

/** The receipt page for a paid order; null when the order isn't there. */
export async function thankYou(
  env: Env,
  orderUuid: string,
): Promise<{ body: string } | { redirect: string } | null> {
  const found = await ordersRepo.findOrderByUuid(env, orderUuid);
  if (!found || !found.pageSlug) return null;
  const slug = found.pageSlug;

  // Only paid orders earn a receipt; an unpaid one goes back with "pending".
  if (found.order.status !== "paid") return { redirect: `/${slug}?payment=pending` };

  const data = found.order.data as OrderData;
  const pageName = found.pageName ?? "your order";
  const lines = data.items
    .map(
      (item) =>
        `<li style="display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid #eceef2">` +
        `<span>${esc(item.name)} <span style="color:#5B6472">× ${item.qty}</span></span>` +
        `<span style="font-variant-numeric:tabular-nums">${money(item.unitCents * item.qty)}</span></li>`,
    )
    .join("");
  const customer = found.customer;
  const contact = found.contact;
  const paidAt = data.payment?.paidAt ?? data.updatedAt;
  const shippingLine =
    data.shippingCents > 0
      ? `<li style="display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid #eceef2">` +
        `<span>Shipping</span>` +
        `<span style="font-variant-numeric:tabular-nums">${money(data.shippingCents)}</span></li>`
      : "";

  return {
    body:
      `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<meta name="robots" content="noindex">` +
      `<title>Thank you · ${esc(pageName)}</title></head>` +
      `<body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;margin:0;padding:40px 20px;color:#14181F;background:#F7F8FA">` +
      `<main style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E3E7EE;border-radius:14px;padding:28px">` +
      `<p style="margin:0 0 6px;color:#FF6500;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Payment received</p>` +
      (data.test
        ? `<p style="margin:0 0 10px;display:inline-block;padding:3px 9px;border-radius:999px;background:#FFF3E6;color:#B45309;font-size:11px;font-weight:800;letter-spacing:.06em">TEST ORDER</p>`
        : "") +
      `<h1 style="margin:0 0 8px;font-size:24px;line-height:1.25">Thank you${contact?.name || customer?.name ? `, ${esc(contact?.name || customer?.name || "")}` : ""}!</h1>` +
      `<p style="margin:0 0 20px;color:#5B6472;font-size:14px;line-height:1.5">` +
      `Your payment of <strong style="color:#14181F">${money(data.totalCents)}</strong> went through. ` +
      `Order <strong style="color:#14181F">${esc(formatOrderNo(found.order.id))}</strong> is confirmed.</p>` +
      `<ul style="margin:0;padding:0;list-style:none;font-size:14px">${lines}${shippingLine}</ul>` +
      `<div style="display:flex;justify-content:space-between;gap:16px;padding:14px 0 0;font-size:15px;font-weight:800">` +
      `<span>Total paid</span><span style="font-variant-numeric:tabular-nums">${money(data.totalCents)}</span></div>` +
      `<p style="margin:18px 0 0;color:#5B6472;font-size:13px;line-height:1.5">` +
      `Paid on ${esc(paidAt)}. We'll reach you at <strong style="color:#14181F">${esc(customer?.email ?? "")}</strong> if anything else is needed.</p>` +
      `<a href="/${esc(slug)}" style="display:inline-block;margin-top:22px;padding:11px 18px;border-radius:9px;background:#FF6500;color:#fff;font-size:14px;font-weight:700;text-decoration:none">Back to the page</a>` +
      `</main>` +
      // The paid cart has no further use; clear it so a reload starts fresh.
      `<script>try{localStorage.removeItem("storesy.checkout."+${JSON.stringify(slug)})}catch(e){}</script>` +
      `</body></html>`,
  };
}
