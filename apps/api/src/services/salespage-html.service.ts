import { SALESPAGE_HTML_PATH_PATTERN, type SalesPageHtmlSlot } from "@storesy/shared";

/**
 * Sales-page HTML documents (R2): one fixed key per page + slot —
 * `salespages/<spg-uuid>/<slot>.html`. Because the key never varies, a save
 * overwrites in place and the path recorded on the row (data.html,
 * data.pagePath) stays valid for the life of the page. Same bucket as product
 * images; D1 stores paths only, never the markup.
 *
 * Slots `component` / `code` / `ai` are the editor's documents; `page` is the
 * rendered public document served at `/<slug>`.
 */

/** Every slot a page may store a document under, the public one included. */
export type StoredHtmlSlot = SalesPageHtmlSlot | "page";

/** Stored object content type — served/edited as HTML everywhere. */
const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

/** True for a path we'd accept back from a client (gates reads/deletes). */
export function isValidHtmlPath(path: string): boolean {
  return SALESPAGE_HTML_PATH_PATTERN.test(path);
}

/** The fixed key for one page + slot — the only place keys are minted. */
export function htmlPathFor(pageUuid: string, slot: StoredHtmlSlot): string {
  return `salespages/${pageUuid}/${slot}.html`;
}

/** Stores one document and returns the path to save on the page row. */
export async function putHtml(
  env: Env,
  pageUuid: string,
  slot: StoredHtmlSlot,
  html: string,
): Promise<string> {
  const path = htmlPathFor(pageUuid, slot);
  await env.IMAGES.put(path, html, {
    httpMetadata: { contentType: HTML_CONTENT_TYPE },
  });
  return path;
}

/** Stored object for a path; null for invalid paths and misses alike. */
export async function getHtml(env: Env, path: string): Promise<R2ObjectBody | null> {
  if (!isValidHtmlPath(path)) return null;
  return env.IMAGES.get(path);
}

/**
 * Best-effort cleanup for paths a save dropped. Callers delete *after* the row
 * is written: a failure then only leaves an unreferenced object behind, never
 * a row pointing at documents that are gone.
 */
export async function deleteHtml(env: Env, paths: string[]): Promise<void> {
  const valid = paths.filter(isValidHtmlPath);
  if (valid.length === 0) return;
  await env.IMAGES.delete(valid);
}
