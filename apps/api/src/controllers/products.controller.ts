import { createProductSchema, updateProductSchema } from "@storesy/shared";
import type { Context } from "../core/context";
import { unauthorized } from "../core/errors";
import * as products from "../services/products.service";

/**
 * Products is a normal signed-in app page: a live session is required, but any
 * role may use it (unlike the owner-only /system tools). Rows themselves are
 * not account-scoped — one install serves one catalog.
 */
function requireSession(ctx: Context): void {
  if (!ctx.session) throw unauthorized();
}

export async function list(ctx: Context): Promise<Response> {
  requireSession(ctx);
  return ctx.json({ products: await products.list(ctx.env) });
}

export async function detail(ctx: Context): Promise<Response> {
  requireSession(ctx);
  return ctx.json(await products.get(ctx.env, ctx.params.uuid ?? ""));
}

export async function update(ctx: Context): Promise<Response> {
  requireSession(ctx);
  const input = await ctx.body(updateProductSchema);
  return ctx.json(await products.update(ctx.env, ctx.params.uuid ?? "", input));
}

export async function create(ctx: Context): Promise<Response> {
  requireSession(ctx);
  const input = await ctx.body(createProductSchema);
  return ctx.created(await products.create(ctx.env, input));
}
