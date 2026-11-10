import { createSalesPageSchema, updateSalesPageSchema } from "@storesy/shared";
import type { Context } from "../core/context";
import { notFound, unauthorized } from "../core/errors";
import type { SalesPageData } from "../models/schema";
import * as salespages from "../services/salespages.service";
import * as tracking from "../services/tracking.service";
import * as visits from "../services/visits.service";

/**
 * Sales pages behaves exactly like products for access: a live session is
 * required for every write and read in the studio; the public slug read is
 * the one signed-out endpoint (the storefront view).
 */
function requireSession(ctx: Context): void {
  if (!ctx.session) throw unauthorized();
}

export async function list(ctx: Context): Promise<Response> {
  requireSession(ctx);
  return ctx.json({ salesPages: await salespages.list(ctx.env) });
}

export async function detail(ctx: Context): Promise<Response> {
  requireSession(ctx);
  return ctx.json(await salespages.get(ctx.env, ctx.params.uuid ?? ""));
}

export async function create(ctx: Context): Promise<Response> {
  requireSession(ctx);
  const input = await ctx.body(createSalesPageSchema);
  return ctx.created(await salespages.create(ctx.env, input));
}

export async function update(ctx: Context): Promise<Response> {
  requireSession(ctx);
  const input = await ctx.body(updateSalesPageSchema);
  return ctx.json(await salespages.update(ctx.env, ctx.params.uuid ?? "", input));
}

export async function remove(ctx: Context): Promise<Response> {
  requireSession(ctx);
  await salespages.remove(ctx.env, ctx.params.uuid ?? "");
  return ctx.noContent();
}

/**
 * GET /api/salespages/public/:slug — the signed-out storefront read. The view
 * is counted off the response path: the RPC lands on the page's counter DO
 * inside `waitUntil`, so a viral page never turns views into D1 writes.
 */
export async function publicRead(ctx: Context): Promise<Response> {
  const page = await salespages.getBySlug(ctx.env, ctx.params.slug ?? "");
  ctx.waitUntil(visits.recordVisit(ctx.env, page.id));
  return ctx.json(page);
}

/** Plain-document 404 — this route's visitors are browsers and crawlers. */
const NOT_FOUND_DOCUMENT =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  "<title>Page not found · Storesy</title></head><body " +
  'style="font-family:system-ui,sans-serif;margin:0;padding:48px 24px;' +
  'text-align:center;color:#14181F;background:#fff">' +
  '<h1 style="font-size:28px;margin:0 0 8px">Page not found</h1>' +
  '<p style="margin:0;color:#5B6472">There is no page at this address.</p></body></html>';

function htmlDocument(ctx: Context, body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Every view is counted, and a save must show up on the next request.
      "Cache-Control": "no-store",
      "X-Request-Id": ctx.requestId,
    },
  });
}

/**
 * GET /:slug — the public storefront page as plain server-hosted HTML:
 * the standalone document the SPA stored in R2 at save time (title, OG tags
 * and every section in the markup — no JavaScript needed to read it).
 * Signed out, counted like the JSON read above. Unknown slug → the branded
 * 404 below, so a mistyped link still reads as a page that isn't there.
 */
export async function publicPage(ctx: Context): Promise<Response> {
  const found = await salespages.getPublicDocument(ctx.env, ctx.params.slug ?? "");
  if (!found) return htmlDocument(ctx, NOT_FOUND_DOCUMENT, 404);
  ctx.waitUntil(visits.recordVisit(ctx.env, found.row.uuid));
  // The merchant's selected trackers ride at the end of the body, read fresh
  // on every view — a changed pixel id needs no re-publish.
  const snippets = await tracking.snippetsFor(
    ctx.env,
    (found.row.data as SalesPageData).trackings ?? [],
  );
  return htmlDocument(ctx, tracking.injectTracking(found.body, snippets));
}

/**
 * GET /* — everything the edge hands over that isn't a page: retired
 * `/p/<slug>` links (the address shape this replaced) and typo'd deep paths.
 * Branded plain HTML with a real 404, because the visitor is a browser
 * following a link — not a client parsing JSON.
 *
 * One carve-out: unknown paths *under* the API prefix stay in the API's
 * envelope. A typo'd endpoint would otherwise hand `JSON.parse` an HTML
 * document, turning a clean 404 into an opaque parse failure.
 */
export function gone(ctx: Context): Response {
  if ((ctx.params["*"] ?? "").startsWith("api/")) throw notFound();
  return htmlDocument(ctx, NOT_FOUND_DOCUMENT, 404);
}
