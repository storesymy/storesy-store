import { DOWNLOAD_FILE_MAX_BYTES } from "@storesy/shared";
import type { Context } from "../core/context";
import { badRequest, notFound, unauthorized, validationFailed } from "../core/errors";
import * as files from "../services/files.service";
import * as products from "../services/products.service";

function checkSession(ctx: Context): void {
  if (!ctx.session) throw unauthorized();
}

function tooLarge(): never {
  throw validationFailed("Check the highlighted fields", {
    file: "That file is too large (max 50 MB)",
  });
}

/**
 * POST /api/files?product=<prd-uuid> — raw file bytes in, stored entry out.
 * Session-gated like every write; the product must exist first. Content
 * addressed: the same bytes always return the same path and never write a
 * second copy into the bucket.
 */
export async function upload(ctx: Context): Promise<Response> {
  checkSession(ctx);

  const productUuid = ctx.url.searchParams.get("product") ?? "";
  if (!files.PRODUCT_UUID_PATTERN.test(productUuid)) {
    throw validationFailed("Check the highlighted fields", {
      product: "Give the product id, e.g. ?product=prd-01a1…",
    });
  }
  // 404s for unknown products before a single byte is stored.
  await products.get(ctx.env, productUuid);

  const declared = Number(ctx.req.headers.get("content-length") ?? "0");
  if (declared > DOWNLOAD_FILE_MAX_BYTES) tooLarge();
  const bytes = await ctx.req.arrayBuffer();
  if (bytes.byteLength === 0) throw badRequest("empty_file", "The file is empty");
  if (bytes.byteLength > DOWNLOAD_FILE_MAX_BYTES) tooLarge();

  const rawName = ctx.req.headers.get("x-file-name") ?? "";
  let decoded = rawName;
  try {
    decoded = decodeURIComponent(rawName);
  } catch {
    // Malformed percent-encoding — the sanitized raw header still works.
  }
  const name = files.sanitizeFileName(decoded);

  const path = await files.putFile(ctx.env, productUuid, name, bytes);
  return ctx.created({ path, name, size: bytes.byteLength });
}

/**
 * GET /api/files/* — stored bytes are the signed-in owner's (401 otherwise):
 * unlike product images, digital goods never go public. Always delivered as
 * an attachment so stored content cannot render as a page.
 */
export async function serve(ctx: Context): Promise<Response> {
  checkSession(ctx);
  const path = ctx.params["*"] ?? "";
  const object = await files.getFile(ctx.env, path);
  if (!object) throw notFound("file_not_found", "No file with that path");

  const fallback = path.split("/").pop() ?? "download";
  const name = (object.customMetadata?.name ?? fallback).replace(/["\\\r\n]/g, "");
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      ETag: object.etag,
    },
  });
}
