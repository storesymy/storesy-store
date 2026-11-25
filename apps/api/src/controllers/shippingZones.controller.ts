import { shippingQuoteSchema, shippingZoneInputSchema } from "@storesy/shared";
import type { Context } from "../core/context";
import { unauthorized } from "../core/errors";
import * as checkout from "../services/checkout.service";
import * as quotes from "../services/shippingQuote.service";
import * as shippingZones from "../services/shippingZones.service";
import { enforceRateLimit } from "../services/rate-limit.service";

/**
 * Shipping Zone is a normal signed-in app page: profile pricing is not
 * credential material, so any role may manage it (like products).
 */
function requireSession(ctx: Context): void {
  if (!ctx.session) throw unauthorized();
}

/** Signed-out: the checkout needs the rate card before a buyer has an account. */
export async function publicRates(ctx: Context): Promise<Response> {
  return ctx.json(await shippingZones.publicRates(ctx.env));
}

/**
 * POST /api/public/shipping-quote — signed out, like the checkout. The cart
 * sends its allowlisted lines and destination; weight, zone and any live
 * MyParcel Asia quote are all resolved server-side.
 */
export async function quote(ctx: Context): Promise<Response> {
  await enforceRateLimit(
    ctx.env,
    `shipping-quote:${ctx.clientIp}`,
    120,
    10 * 60 * 1000,
    "Too many shipping checks — please wait a moment.",
  );
  const input = await ctx.body(shippingQuoteSchema);
  const { lines } = await checkout.resolveCheckout(ctx.env, input.slug, input.items);
  const { snapshot, ...quote } = await quotes.quoteShipping(ctx.env, {
    lines,
    destination: input.destination,
  });
  // The snapshot is internal order state; the cart only needs the public quote.
  void snapshot;
  return ctx.json(quote);
}

export async function list(ctx: Context): Promise<Response> {
  requireSession(ctx);
  return ctx.json({ shippingZones: await shippingZones.list(ctx.env) });
}

export async function detail(ctx: Context): Promise<Response> {
  requireSession(ctx);
  return ctx.json(await shippingZones.get(ctx.env, ctx.params.uuid ?? ""));
}

export async function create(ctx: Context): Promise<Response> {
  requireSession(ctx);
  const input = await ctx.body(shippingZoneInputSchema);
  return ctx.created(await shippingZones.create(ctx.env, input));
}

export async function update(ctx: Context): Promise<Response> {
  requireSession(ctx);
  const input = await ctx.body(shippingZoneInputSchema);
  return ctx.json(await shippingZones.update(ctx.env, ctx.params.uuid ?? "", input));
}

export async function remove(ctx: Context): Promise<Response> {
  requireSession(ctx);
  await shippingZones.remove(ctx.env, ctx.params.uuid ?? "");
  return ctx.noContent();
}
