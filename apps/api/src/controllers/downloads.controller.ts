import type { Context } from "../core/context";
import { notFound } from "../core/errors";
import * as downloads from "../services/downloads.service";

/**
 * GET /api/public/downloads/:order/:product/:index — the buyer's own file,
 * signed out. The link comes from the thank-you email and is scoped to one
 * paid order and one purchased product; see downloads.service for the checks.
 */
export async function serve(ctx: Context): Promise<Response> {
  const index = Number.parseInt(ctx.params.index ?? "", 10);
  if (!Number.isInteger(index) || index < 0) {
    throw notFound("download_not_found", "This download link isn't valid");
  }

  const { object, name } = await downloads.resolve(
    ctx.env,
    ctx.params.order ?? "",
    ctx.params.product ?? "",
    index,
  );

  // Always an attachment: stored bytes must never render as a page.
  const filename = (name || "download").replace(/["\\\r\n]/g, "");
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
      ETag: object.etag,
    },
  });
}
