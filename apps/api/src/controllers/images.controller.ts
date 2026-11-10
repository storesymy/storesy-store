import type { Context } from "../core/context";
import { badRequest, notFound, unauthorized, validationFailed } from "../core/errors";
import * as images from "../services/images.service";
import * as products from "../services/products.service";

function checkSession(ctx: Context): void {
  if (!ctx.session) throw unauthorized();
}

/**
 * POST /api/images?product=<prd-uuid> — raw image body in, stored path out.
 * Session-gated like every write; the product must exist so keys never mint
 * for ghosts. The client then saves the returned path on the product row.
 */
export async function upload(ctx: Context): Promise<Response> {
  checkSession(ctx);

  const productUuid = ctx.url.searchParams.get("product") ?? "";
  if (!images.PRODUCT_UUID_PATTERN.test(productUuid)) {
    throw validationFailed("Check the highlighted fields", {
      product: "Give the product id, e.g. ?product=prd-01a1…",
    });
  }
  // 404s for unknown products before a single byte is stored.
  await products.get(ctx.env, productUuid);

  const contentType = (ctx.req.headers.get("content-type") ?? "")
    .split(";")[0]!
    .trim()
    .toLowerCase();
  if (!images.isAllowedContentType(contentType)) {
    throw validationFailed("Check the highlighted fields", {
      file: "Upload a PNG, JPEG or WebP image",
    });
  }

  const declared = Number(ctx.req.headers.get("content-length") ?? "0");
  if (declared > images.IMAGE_MAX_BYTES) {
    throw validationFailed("Check the highlighted fields", {
      file: "Image is too large (max 5 MB)",
    });
  }
  const bytes = await ctx.req.arrayBuffer();
  if (bytes.byteLength === 0) throw badRequest("empty_image", "The image file is empty");
  if (bytes.byteLength > images.IMAGE_MAX_BYTES) {
    throw validationFailed("Check the highlighted fields", {
      file: "Image is too large (max 5 MB)",
    });
  }

  const path = await images.putImage(ctx.env, productUuid, contentType, bytes);
  return ctx.created({ path });
}

/**
 * GET /api/images/* — public read (the storefront won't be signed in), with
 * immutable caching: a stored path never changes, it only disappears.
 */
export async function serve(ctx: Context): Promise<Response> {
  const path = ctx.params["*"] ?? "";
  const object = await images.getImage(ctx.env, path);
  if (!object) throw notFound("image_not_found", "No image with that path");
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: object.etag,
    },
  });
}
