import type { ImportKind } from "@storesy/shared";
import { AppError, badRequest } from "../core/errors";
import { assertSafeUrl } from "./ssrf";

/**
 * The fetch half of the URL importer: pulls a page or one of its stylesheets
 * through the Worker (the browser can't do it cross-origin), with hard caps
 * on size, time and redirects. Every URL — first request and each redirect
 * hop — passes the SSRF gate before `fetch` sees it.
 */

export interface FetchedResource {
  finalUrl: string;
  contentType: string;
  body: string;
}

const DOCUMENT_MAX_BYTES = 3_000_000;
const STYLESHEET_MAX_BYTES = 1_000_000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

/** A browser UA — plenty of sites 403 anything that looks like a bot. */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DOCUMENT_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const STYLESHEET_TYPES = new Set(["text/css", "text/plain", "application/octet-stream"]);

/** Reads the body with a byte ceiling; a lying Content-Length can't slip past. */
async function readCapped(response: Response, maxBytes: number): Promise<ArrayBuffer> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (!response.body) return new ArrayBuffer(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

function tooLarge(): AppError {
  return new AppError(413, "too_large", "That address is too large to import.");
}

function decodeBody(buffer: ArrayBuffer, contentTypeHeader: string): string {
  const charset = /charset=([^;\s]+)/i.exec(contentTypeHeader)?.[1]?.replace(/["']/g, "");
  try {
    return new TextDecoder(charset || "utf-8").decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer); // unknown label — plain UTF-8.
  }
}

export async function fetchRemote(
  env: Env,
  rawUrl: string,
  kind: ImportKind,
): Promise<FetchedResource> {
  const allowLocalhost = env.ENVIRONMENT === "development";
  const maxBytes = kind === "document" ? DOCUMENT_MAX_BYTES : STYLESHEET_MAX_BYTES;
  const allowedTypes = kind === "document" ? DOCUMENT_TYPES : STYLESHEET_TYPES;
  const accept = kind === "document" ? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" : "text/css,*/*;q=0.5";

  let current = assertSafeUrl(rawUrl, allowLocalhost);
  let redirects = 0;

  for (;;) {
    let response: Response;
    try {
      response = await fetch(current.href, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          "User-Agent": USER_AGENT,
          Accept: accept,
          "Accept-Language": "en",
        },
      });
    } catch (error) {
      if ((error as Error | undefined)?.name === "TimeoutError") {
        throw new AppError(408, "timeout", "That address took too long to respond.");
      }
      throw new AppError(400, "fetch_failed", "Couldn't reach that address — check the URL.");
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw badRequest("fetch_failed", "That address redirected without a target.");
      redirects += 1;
      if (redirects > MAX_REDIRECTS) {
        throw badRequest("fetch_failed", "That address redirects too many times.");
      }
      // A redirect can aim anywhere — the new target clears the gate too.
      current = assertSafeUrl(new URL(location, current).href, allowLocalhost);
      void response.body?.cancel().catch(() => undefined);
      continue;
    }

    if (!response.ok) {
      throw badRequest("fetch_failed", `That address answered with HTTP ${response.status}.`);
    }

    const contentTypeHeader = response.headers.get("content-type") ?? "";
    const contentType = (contentTypeHeader.split(";")[0] ?? "").trim().toLowerCase();
    if (contentType && !allowedTypes.has(contentType)) {
      throw badRequest(
        "not_html",
        kind === "document"
          ? "That address isn't an HTML page."
          : "That address didn't return a stylesheet.",
      );
    }

    const buffer = await readCapped(response, maxBytes);
    const body = decodeBody(buffer, contentTypeHeader);
    if (body.trim().length === 0) throw badRequest("fetch_failed", "That address came back empty.");
    return { finalUrl: current.href, contentType, body };
  }
}
