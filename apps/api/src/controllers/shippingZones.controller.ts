import { shippingZoneInputSchema } from "@storesy/shared";
import type { Context } from "../core/context";
import { unauthorized } from "../core/errors";
import * as shippingZones from "../services/shippingZones.service";

/**
 * Shipping Zone is a normal signed-in app page: profile pricing is not
 * credential material, so any role may manage it (like products).
 */
function requireSession(ctx: Context): void {
  if (!ctx.session) throw unauthorized();
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
