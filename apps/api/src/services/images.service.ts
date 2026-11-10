import { IMAGE_PATH_PATTERN } from "@storesy/shared";

/**
 * Product image storage (R2): cropped bytes live in the bucket, D1 keeps only
 * the paths. Keys are minted here — `products/<prd-uuid>/<uuid>.<ext>` — so a
 * product's pictures are grouped for later lifecycle work.
 */

/** Cropper output is a few hundred KB; this is a hard request-body ceiling. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** The upload endpoint only ever accepts the formats the cropper emits. */
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
};

/** Product uuid shape (`prd-` + UUID), as minted by entityUuid. */
export const PRODUCT_UUID_PATTERN =
  /^prd[-_][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isAllowedContentType(contentType: string): boolean {
  return contentType in IMAGE_EXTENSIONS;
}

/** True for a path we'd accept back from a client (also gates reads/deletes). */
export function isValidPath(path: string): boolean {
  return IMAGE_PATH_PATTERN.test(path);
}

/** Stores one image and returns the path to save on the product row. */
export async function putImage(
  env: Env,
  productUuid: string,
  contentType: string,
  bytes: ArrayBuffer,
): Promise<string> {
  const ext = IMAGE_EXTENSIONS[contentType];
  if (!ext) throw new Error(`unsupported image content type: ${contentType}`);
  const path = `products/${productUuid}/${crypto.randomUUID()}.${ext}`;
  await env.IMAGES.put(path, bytes, { httpMetadata: { contentType } });
  return path;
}

/** Stored object for a path; null for invalid paths and misses alike. */
export async function getImage(
  env: Env,
  path: string,
): Promise<R2ObjectBody | null> {
  if (!isValidPath(path)) return null;
  return env.IMAGES.get(path);
}

/**
 * Best-effort cleanup for paths a save dropped. Callers delete *after* the row
 * is written: a failure then only leaves an unreferenced object behind, never
 * a row pointing at bytes that are gone.
 */
export async function deleteImages(env: Env, paths: string[]): Promise<void> {
  const valid = paths.filter(isValidPath);
  if (valid.length === 0) return;
  await env.IMAGES.delete(valid);
}
