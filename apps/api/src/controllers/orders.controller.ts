import { createOrderSchema, updateOrderFulfilmentSchema } from "@storesy/shared";
import type { Context } from "../core/context";
import { unauthorized } from "../core/errors";
import * as orders from "../services/orders.service";
import { enforceRateLimit } from "../services/rate-limit.service";

/**
 * Orders: the public submit is the only signed-out write in the app, and the
 * merchant list is a plain session read. Same access rule as products and
 * pages — one deployment serves one catalogue, so no per-account scoping.
 */

/**
 * Generous for a real buyer (a retry after a 409 still fits), tight against
 * a script trying to hammer rows into the table. Counted per client IP with
 * invalid bodies included, so a fuzzing loop exhausts itself.
 */
const ORDER_LIMIT = 60;
const ORDER_WINDOW_MS = 60 * 60 * 1000;

/**
 * POST /api/public/orders — the checkout block on `/<slug>` submits here,
 * signed out. Rate-limited per IP before the body is even parsed; the schema
 * validates shape, the service revalidates every price against the rows.
 */
export async function create(ctx: Context): Promise<Response> {
  await enforceRateLimit(
    ctx.env,
    `order:${ctx.clientIp}`,
    ORDER_LIMIT,
    ORDER_WINDOW_MS,
    "Too many orders from this device — please try again in a few minutes.",
  );

  const input = await ctx.body(createOrderSchema);
  const order = await orders.create(ctx.env, input);
  return ctx.json({ order }, 201);
}

/**
 * GET /api/orders — the merchant's list, newest first; `?page=spg-…` narrows
 * it to one sales page.
 */
export async function list(ctx: Context): Promise<Response> {
  if (!ctx.session) throw unauthorized();
  const page = ctx.url.searchParams.get("page");
  return ctx.json({ orders: await orders.list(ctx.env, page ?? undefined) });
}

/** GET /api/orders/:uuid — one order for the detail page. */
export async function detail(ctx: Context): Promise<Response> {
  if (!ctx.session) throw unauthorized();
  return ctx.json(await orders.get(ctx.env, ctx.params.uuid ?? ""));
}

/** PATCH /api/orders/:uuid/fulfilment — mark fulfilled/delivered or reset. */
export async function fulfilment(ctx: Context): Promise<Response> {
  if (!ctx.session) throw unauthorized();
  const input = await ctx.body(updateOrderFulfilmentSchema);
  return ctx.json(await orders.setFulfilment(ctx.env, ctx.params.uuid ?? "", input.status));
}
