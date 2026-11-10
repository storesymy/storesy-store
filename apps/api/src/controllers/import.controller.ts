import { importFetchQuerySchema } from "@storesy/shared";
import type { Context } from "../core/context";
import { unauthorized, validationFailed } from "../core/errors";
import * as importer from "../services/import.service";
import { enforceRateLimit } from "../services/rate-limit.service";

/** Generous for one import (~15 stylesheet pulls), tight against abuse. */
const IMPORT_LIMIT = 60;
const IMPORT_WINDOW_MS = 10 * 60 * 1000;

/**
 * GET /api/import/fetch?url=&kind=document|stylesheet — the SPA's window to
 * the web for the sales-page importer. Session-gated, rate-limited per user,
 * size/time-capped in the service, and every URL (redirect hops included)
 * clears the SSRF gate before a byte is fetched.
 */
export async function fetchRemote(ctx: Context): Promise<Response> {
  if (!ctx.session) throw unauthorized();

  await enforceRateLimit(
    ctx.env,
    `import:${ctx.session.userId}:${ctx.clientIp}`,
    IMPORT_LIMIT,
    IMPORT_WINDOW_MS,
    "Too many import requests — give it a minute, then try again.",
  );

  const parsed = importFetchQuerySchema.safeParse({
    url: ctx.url.searchParams.get("url") ?? "",
    kind: ctx.url.searchParams.get("kind") ?? "",
  });
  if (!parsed.success) {
    throw validationFailed("Check the highlighted fields", {
      url: "Give a full http(s) address, e.g. https://example.com/page",
      kind: "Pick what to fetch",
    });
  }

  const result = await importer.fetchRemote(ctx.env, parsed.data.url, parsed.data.kind);
  return ctx.json(result);
}
