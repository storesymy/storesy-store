import { FILE_PATH_PATTERN } from "@storesy/shared";
import { PRODUCT_UUID_PATTERN } from "./images.service";

/**
 * Digital product files (R2) — the actual bytes behind "Download File". The
 * bucket already backs images; this module adds content addressing: the key
 * is derived from a SHA-256 of the bytes (`downloads/<prd-uuid>/<sha256>.<ext>`),
 * so identical content always lands on the same object and re-uploads never
 * write a second copy.
 */

export { PRODUCT_UUID_PATTERN };

/** True for a download path we'd accept back from a client (gates read/delete). */
export function isValidFilePath(path: string): boolean {
  return FILE_PATH_PATTERN.test(path);
}

/** SHA-256 of the bytes, hex — the identity the object key is built from. */
export async function hashBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Lowercase extension from the original name; "" when absent or implausible. */
export function extensionFor(name: string): string {
  if (!name.includes(".")) return "";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return /^[a-z0-9]{1,12}$/.test(ext) ? ext : "";
}

/**
 * Original filename → header-safe basename: no traversal, no control chars,
 * bounded length. Falls back to a generic name when nothing survives.
 */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\x00-\x1f\x7f"]/g, "") // control chars + quotes: never in a header
    .trim()
    .slice(0, 200);
  return cleaned || "download";
}

/**
 * Stores one download and returns its path. Content addressed: if the object
 * already exists (same bytes seen before), the write is skipped entirely.
 */
export async function putFile(
  env: Env,
  productUuid: string,
  originalName: string,
  bytes: ArrayBuffer,
): Promise<string> {
  const hash = await hashBytes(bytes);
  const ext = extensionFor(originalName);
  const path = `downloads/${productUuid}/${hash}${ext ? `.${ext}` : ""}`;
  const existing = await env.IMAGES.head(path);
  if (!existing) {
    await env.IMAGES.put(path, bytes, {
      // Always octet-stream: served with `Content-Disposition: attachment`,
      // stored bytes must never be renderable as a page.
      httpMetadata: { contentType: "application/octet-stream" },
      customMetadata: { name: originalName },
    });
  }
  return path;
}

/** Stored object for a path; null for invalid paths and misses alike. */
export async function getFile(env: Env, path: string): Promise<R2ObjectBody | null> {
  if (!isValidFilePath(path)) return null;
  return env.IMAGES.get(path);
}

/**
 * Best-effort cleanup for paths a save dropped — same contract as
 * images.deleteImages: delete only after the row is written.
 */
export async function deleteFiles(env: Env, paths: string[]): Promise<void> {
  const valid = paths.filter(isValidFilePath);
  if (valid.length === 0) return;
  await env.IMAGES.delete(valid);
}
