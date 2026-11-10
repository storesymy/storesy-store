import type { Context } from "../core/context";
import { unauthorized } from "../core/errors";
import * as customers from "../services/customers.service";

/**
 * GET /api/customers?q=&page=&perPage=&sort=&dir= — the merchant's customer
 * list. `sort` is `no` (row id) or `ltv`, `dir` is `asc`/`desc`; the default is
 * newest customer first. Session-gated like orders: this is PII, but every
 * signed-in account can already read it through an order's customer block.
 */
export async function detail(ctx: Context): Promise<Response> {
  if (!ctx.session) throw unauthorized();
  return ctx.json(await customers.get(ctx.env, ctx.params.uuid ?? ""));
}

export async function list(ctx: Context): Promise<Response> {
  if (!ctx.session) throw unauthorized();
  const params = ctx.url.searchParams;
  const page = Number.parseInt(params.get("page") ?? "1", 10);
  const perPage = Number.parseInt(params.get("perPage") ?? "30", 10);
  const search = (params.get("q") ?? "").slice(0, 120);
  const sort = params.get("sort") === "ltv" ? "ltv" : "no";
  const dir = params.get("dir") === "asc" ? "asc" : "desc";
  return ctx.json(
    await customers.list(ctx.env, {
      search,
      page: Number.isFinite(page) ? page : 1,
      perPage: Number.isFinite(perPage) ? perPage : undefined,
      sort,
      dir,
    }),
  );
}
