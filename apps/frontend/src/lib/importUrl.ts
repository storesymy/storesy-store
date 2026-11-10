import { formatHtml } from "./salesHtml";

/**
 * "Import from URL" — turns somebody's live page into this page's HTML.
 *
 * Split of labour: the Worker fetches (CORS-free, SSRF-gated, size-capped —
 * see /api/import/fetch); this module does the DOM work with `DOMParser`:
 *
 *  1. inline every stylesheet (each pulled through the proxy, `@import`
 *     chains spliced in place, `url()`s absolutized against the sheet's own
 *     address — fonts keep loading from their CDN, images become `none`),
 *  2. replace ALL media — img/video/audio/iframe/embed/object, srcsets,
 *     posters and CSS image urls — with placeholder art. Nothing loads from
 *     the source at view time; the owner swaps real pictures in later with
 *     the familiar Change flow (original URLs parked on `data-storesy-src`),
 *  3. keep the page's scripts — they run inside the sandboxed snapshot
 *     frame — while stripping the outright-dangerous surface (inline event
 *     handlers, `javascript:` URLs, meta refresh/CSP),
 *  4. inject a height probe (the parent can't measure an opaque-origin
 *     frame; this reports its own scrollHeight), then pretty-print through
 *     the same formatter Code mode uses.
 */

/** Stylesheet pulls per import (link tags + @import chains, budget shared). */
const SHEET_MAX = 15;
/** How deep `@import` chains are followed before the rule is dropped. */
const IMPORT_DEPTH_MAX = 2;
const SOURCE_URL_MAX = 2048;

/**
 * The proxy's document cap, mirrored for local uploads: an .html file picked
 * from disk runs through the same pipeline, so it obeys the same ceiling
 * (see `import.service.ts` on the Worker).
 */
export const DOCUMENT_MAX_BYTES = 3_000_000;

export interface ImportOutcome {
  /** Pretty-printed full document — stored as `SalesPage.html`. */
  html: string;
  /** Final address after redirects — recorded as `SalesPage.source`. */
  finalUrl: string;
  sheetsInlined: number;
  mediaReplaced: number;
  /** Height viewport units (100vh & friends) locked to pixels. */
  viewportLocked: number;
}

type StepReporter = (label: string) => void;

/* ---------------------------------------------------------------- fetch -- */

interface ProxyResponse {
  /** Final address after redirects — the base for every relative URL. */
  finalUrl: string;
  contentType: string;
  body: string;
}

async function fetchProxy(url: string, kind: "document" | "stylesheet"): Promise<ProxyResponse> {
  const query = new URLSearchParams({ url, kind });
  const response = await fetch(`/api/import/fetch?${query.toString()}`, { credentials: "include" });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON edge (proxy hiccup) — the generic message below covers it.
  }
  const message = (payload as { error?: { message?: string } } | null)?.error?.message;
  if (!response.ok) throw new Error(message ?? "Couldn't read that address.");
  return payload as ProxyResponse;
}

/** "example.com/x" → "https://example.com/x"; only http(s) survives. */
export function normalizeImportUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Paste the page address first.");
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("That doesn't look like a web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http:// and https:// pages can be imported.");
  }
  return url.href;
}

/* ---------------------------------------------------------- placeholders -- */

/** Duotone pairs in the spirit of the app's preset art: warm, never loud. */
const PLACEHOLDER_TONES: Array<[string, string]> = [
  ["#FDE6C8", "#F2AF76"],
  ["#DCE9FF", "#9CBDF4"],
  ["#E4F5E0", "#9CD2A4"],
  ["#F1E7FF", "#C3A1ED"],
];

/** An inline-SVG stand-in for one media slot — no network, any origin. */
function placeholderDataUri(index: number): string {
  const [from, to] = PLACEHOLDER_TONES[index % PLACEHOLDER_TONES.length] as [string, string];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
    `</linearGradient>` +
    `<radialGradient id="h" cx="0.3" cy="0.22" r="0.9">` +
    `<stop offset="0" stop-color="#ffffff" stop-opacity="0.8"/>` +
    `<stop offset="0.6" stop-color="#ffffff" stop-opacity="0"/>` +
    `</radialGradient></defs>` +
    `<rect width="800" height="600" fill="url(#g)"/>` +
    `<rect width="800" height="600" fill="url(#h)"/>` +
    `<g fill="none" stroke="#5B4636" stroke-opacity="0.38" stroke-width="11">` +
    `<rect x="268" y="250" width="264" height="164" rx="22"/>` +
    `<circle cx="400" cy="332" r="48"/>` +
    `<path d="M462 274h34" stroke-linecap="round"/></g>` +
    `<circle cx="484" cy="274" r="9" fill="#5B4636" fill-opacity="0.38"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/* --------------------------------------------------------------- css ------ */

const FONT_URL_RE = /\.(?:woff2?|ttf|otf|eot)(?:[?#][^\s'")]*)?$/i;

/**
 * Rewrites one chunk of CSS: fragment refs and data URIs stay, fonts get
 * absolutized against `baseUrl` (they load CORS-clean from their CDN), and
 * every other `url()` is media → `none` (placeholder policy — the source's
 * pixels never load at view time).
 */
function rewriteCssUrls(css: string, baseUrl: string): { css: string; mediaHidden: number } {
  let mediaHidden = 0;
  const out = css.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (match, _quote: string, rawValue: string) => {
      const value = rawValue.trim();
      if (value.startsWith("#") || value.startsWith("data:")) return match;
      let absolute: string;
      try {
        absolute = new URL(value, baseUrl).href;
      } catch {
        mediaHidden += 1;
        return "none";
      }
      if (FONT_URL_RE.test(absolute)) return `url("${absolute}")`;
      mediaHidden += 1;
      return "none";
    },
  );
  return { css: out, mediaHidden };
}

interface SheetBudget {
  left: number;
}

/** Fetch one stylesheet and fully process it (imports + url() rewrites). */
async function fetchStylesheet(rawUrl: string, depth: number, budget: SheetBudget): Promise<string> {
  if (budget.left <= 0 || depth > IMPORT_DEPTH_MAX) throw new Error("style budget exhausted");
  budget.left -= 1;
  const fetched = await fetchProxy(rawUrl, "stylesheet");
  // url()s inside a sheet resolve against the SHEET's own final address.
  return processCssText(fetched.body, fetched.finalUrl, depth, budget);
}

/**
 * Shared CSS surgery for both `<link>` sheets and inline `<style>` bodies:
 * `@import` rules are fetched and their text spliced in place (imports must
 * stay at the top of a sheet — inlining keeps them valid), then the url()
 * pass runs over everything with the sheet's own address as the base.
 */
async function processCssText(
  css: string,
  baseUrl: string,
  depth: number,
  budget: SheetBudget,
): Promise<string> {
  const importRe = /@import\s+(?:url\(\s*['"]?([^'")]+)['"]?\s*\)|['"]([^'"]+)['"])\s*[^;]*;/gi;
  const pulls: Array<string | null> = [];
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(css)) !== null) {
    const target = match[1] ?? match[2] ?? "";
    let text: string | null = null;
    try {
      text = await fetchStylesheet(new URL(target, baseUrl).href, depth + 1, budget);
    } catch {
      text = null; // lost the sub-sheet: drop the rule (never a hot-link)
    }
    pulls.push(text);
  }
  if (pulls.length > 0) {
    let index = 0;
    css = css.replace(importRe, () => pulls[index++] ?? "");
  }
  return rewriteCssUrls(css, baseUrl).css;
}

async function inlineStylesheets(doc: Document, pageUrl: string): Promise<number> {
  const budget: SheetBudget = { left: SHEET_MAX };
  const links = [...doc.querySelectorAll("link")].filter((link) => {
    const rel = (link.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
    return rel.includes("stylesheet") && link.hasAttribute("href");
  });

  let inlined = 0;
  for (const link of links) {
    const href = link.getAttribute("href") ?? "";
    let resolved: string;
    try {
      resolved = new URL(href, pageUrl).href;
    } catch {
      link.remove();
      continue;
    }
    let text: string | null = null;
    try {
      text = await fetchStylesheet(resolved, 0, budget);
    } catch {
      text = null; // a dead stylesheet degrades the look, never the load
    }
    if (text !== null) {
      const style = doc.createElement("style");
      style.setAttribute("data-storesy-import", "stylesheet");
      style.textContent = text;
      link.replaceWith(style);
      inlined += 1;
    } else {
      link.remove();
    }
  }

  // Existing <style> bodies get the same surgery (their @imports and urls).
  for (const style of doc.querySelectorAll("style")) {
    const body = style.textContent ?? "";
    if (body.trim().length === 0) continue;
    style.textContent = await processCssText(body, pageUrl, 0, budget);
  }

  // Every remaining <link> (preload/prefetch/icon/preconnect/…) would fetch
  // the SOURCE'S assets when the snapshot renders — drop them all.
  for (const link of doc.querySelectorAll("link")) link.remove();
  return inlined;
}

/**
 * Height viewport units (100vh, svh/lvh/dvh) resolve against the viewport of
 * whatever document hosts the CSS. The snapshot frame is height-synced: the
 * parent sizes the frame from the page's own reported height — so a
 * `min-height:100vh` element grows with its own report, grows again, and runs
 * away to the clamp (the frame ends up ~20000px tall and looks nothing like
 * the source). Locking the units to pixels against the viewport of the
 * importing browser — the same one the page is previewed in — keeps the
 * layout the author designed for and breaks the loop for good. Width units
 * (vw) stay: the frame's width never feeds back.
 */
const VH_VALUE_RE = /(^|[^\w.-])(-?(?:\d+(?:\.\d+)?|\.\d+))(dvh|lvh|svh|vh)\b/gi;

function lockViewportHeights(doc: Document, refPx: number): number {
  let locked = 0;
  const convert = (css: string): string =>
    css.replace(VH_VALUE_RE, (_match, lead: string, num: string) => {
      locked += 1;
      const px = Math.round((parseFloat(num) * refPx) / 100);
      return `${lead}${px}px`;
    });

  // <style> bodies: the page's own CSS plus every sheet inlined above.
  for (const style of doc.querySelectorAll("style")) {
    const body = style.textContent ?? "";
    if (body.search(VH_VALUE_RE) < 0) continue;
    VH_VALUE_RE.lastIndex = 0; // .search above ran the global regex
    style.textContent = convert(body);
  }

  // Inline style attributes (style="min-height:100vh") — same risk.
  for (const el of doc.querySelectorAll("[style]")) {
    const attr = el.getAttribute("style") ?? "";
    const next = convert(attr);
    if (next !== attr) el.setAttribute("style", next);
  }
  return locked;
}

/* -------------------------------------------------------------- media ----- */

const LAZY_SRC_ATTRS = ["data-src", "data-lazy-src", "data-original", "data-lazy", "data-srcset"];

function firstSrcsetCandidate(srcset: string | null): string {
  if (!srcset) return "";
  return (srcset.split(",")[0] ?? "").trim().split(/\s+/)[0] ?? "";
}

function parkSource(el: Element, original: string | null): void {
  const value = (original ?? "").trim();
  if (value) el.setAttribute("data-storesy-src", value.slice(0, SOURCE_URL_MAX));
}

/** Replaces every drawable asset with placeholder art. Returns the count. */
function replaceMedia(doc: Document, pageUrl: string): number {
  let count = 0;
  let index = 0;
  const nextPlaceholder = () => placeholderDataUri(index++);

  // <picture> sources outrank the inner <img> — they go first.
  for (const source of doc.querySelectorAll("picture source")) source.remove();

  for (const img of doc.querySelectorAll("img")) {
    // Lazy loaders keep the real URL in data-*; park THAT, then drop every
    // attribute a kept script could re-trigger into a network fetch.
    const lazy = LAZY_SRC_ATTRS.map((attr) => img.getAttribute(attr)).find((value) => value);
    const original =
      lazy ?? img.getAttribute("src") ?? firstSrcsetCandidate(img.getAttribute("srcset"));
    parkSource(img, original);
    for (const attr of LAZY_SRC_ATTRS) img.removeAttribute(attr);
    img.removeAttribute("srcset");
    img.removeAttribute("sizes");
    img.setAttribute("src", nextPlaceholder());
    img.setAttribute("data-storesy-ph", "");
    count += 1;
  }

  for (const video of doc.querySelectorAll("video")) {
    video.removeAttribute("src");
    for (const child of [...video.querySelectorAll("source"), ...video.querySelectorAll("track")]) {
      child.remove();
    }
    parkSource(video, video.getAttribute("poster"));
    video.setAttribute("poster", nextPlaceholder());
    video.setAttribute("data-storesy-ph", "");
    count += 1;
  }

  for (const audio of doc.querySelectorAll("audio")) {
    audio.removeAttribute("src");
    for (const source of audio.querySelectorAll("source")) source.remove();
    count += 1;
  }

  // Frame-like media (iframe/embed/object) become a placeholder image that
  // keeps the element's sizing attributes, so the layout doesn't jump.
  const swapToPlaceholder = (el: Element, original: string | null, alt: string) => {
    const img = doc.createElement("img");
    parkSource(img, original);
    for (const attr of ["width", "height", "align", "style", "class"]) {
      const value = el.getAttribute(attr);
      if (value !== null && attr !== "class") img.setAttribute(attr, value);
      if (attr === "class" && value) img.setAttribute("class", value);
    }
    img.setAttribute("alt", alt);
    img.setAttribute("src", nextPlaceholder());
    img.setAttribute("data-storesy-ph", "");
    el.replaceWith(img);
    count += 1;
  };

  for (const frame of [...doc.querySelectorAll("iframe"), ...doc.querySelectorAll("embed")]) {
    swapToPlaceholder(frame, frame.getAttribute("src"), frame.getAttribute("title") ?? "Embedded content");
  }
  for (const object of doc.querySelectorAll("object")) {
    swapToPlaceholder(object, object.getAttribute("data"), object.getAttribute("title") ?? "Embedded content");
  }

  // Inline <svg><image> references and the legacy background= attribute.
  for (const image of doc.querySelectorAll("image")) {
    image.setAttribute("href", nextPlaceholder());
    image.removeAttribute("xlink:href");
    count += 1;
  }
  for (const el of doc.querySelectorAll("[background]")) {
    el.removeAttribute("background");
    count += 1;
  }

  // Inline style attributes: same url() policy as stylesheets, resolved
  // against the page address (a DOMParser document's own baseURI is blank).
  for (const el of doc.querySelectorAll("[style]")) {
    const value = el.getAttribute("style") ?? "";
    if (!/url\(/i.test(value)) continue;
    const result = rewriteCssUrls(value, pageUrl);
    if (result.mediaHidden > 0) {
      el.setAttribute("style", result.css);
      count += result.mediaHidden;
    }
  }

  return count;
}

/* ------------------------------------------------------------- hygiene ---- */

function sanitize(doc: Document): void {
  // Meta refresh hijacks the snapshot; a page's own CSP would block the
  // height probe and our inlined styles. Both go.
  for (const meta of doc.querySelectorAll("meta[http-equiv]")) {
    const equiv = (meta.getAttribute("http-equiv") ?? "").toLowerCase();
    if (equiv === "refresh" || equiv === "content-security-policy") meta.remove();
  }

  // Inline handlers and javascript: URLs — gone in every mode. (Scripts as
  // such stay: the sandbox is what contains them.)
  for (const el of doc.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
      } else if (
        (name === "href" || name === "action" || name === "formaction") &&
        attr.value.trim().toLowerCase().startsWith("javascript:")
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }
}

/**
 * The height probe: injected at the end of <body>, it postMessages the
 * document's scroll height on load and on every ResizeObserver tick. The
 * parent validates `event.source` before believing a number.
 */
const HEIGHT_SNIPPET =
  `(() => { const send = () => parent.postMessage({ storesy: "height", h: document.documentElement.scrollHeight }, "*"); ` +
  `addEventListener("load", send); ` +
  `new ResizeObserver(send).observe(document.documentElement); ` +
  `send(); })();`;

function injectHeightProbe(doc: Document): void {
  const script = doc.createElement("script");
  script.setAttribute("data-storesy-import", "height");
  script.textContent = HEIGHT_SNIPPET;
  (doc.body ?? doc.documentElement).appendChild(script);
}

/**
 * The same probe as a string, for documents that reach the frame as markup
 * rather than as a parsed DOM. An opaque frame can't be measured from out
 * here, so the srcdoc carries the probe that postMessages its own height.
 *
 * Every imported page already has one — the importer bakes it in — so this
 * only ever fires for a complete document someone typed or pasted by hand,
 * and it stamps at render time: the stored code stays exactly what they
 * wrote, exactly what the Code view shows.
 */
export function withHeightProbe(html: string): string {
  if (html.includes("data-storesy-import")) return html;
  const probe = `<script data-storesy-import="height">${HEIGHT_SNIPPET}</script>`;
  const at = html.lastIndexOf("</body>");
  return at === -1 ? `${html}${probe}` : `${html.slice(0, at)}${probe}${html.slice(at)}`;
}

/* ------------------------------------------------------------- pipeline --- */

/**
 * Runs the whole import. `onStep` narrates progress for the dialog; throws
 * `Error` with a user-facing message on any failure (nothing is stored).
 */
export async function importUrlToHtml(rawUrl: string, onStep: StepReporter): Promise<ImportOutcome> {
  const startUrl = normalizeImportUrl(rawUrl);

  onStep("Fetching the page…");
  const page = await fetchProxy(startUrl, "document");
  const pageUrl = page.finalUrl; // final address after redirects
  const doc = new DOMParser().parseFromString(page.body, "text/html");

  // <base> becomes the document's own address: relative anchors and script
  // srcs resolve where they always did, while target="_blank" keeps link
  // clicks out of the snapshot frame itself.
  for (const base of doc.querySelectorAll("base")) base.remove();
  const base = doc.createElement("base");
  base.setAttribute("href", pageUrl);
  base.setAttribute("target", "_blank");
  (doc.head ?? doc.documentElement).prepend(base);

  onStep("Inlining stylesheets…");
  const sheetsInlined = await inlineStylesheets(doc, pageUrl);

  // After inlining, so sheets pulled from <link>s are converted as well.
  const viewportLocked = lockViewportHeights(doc, Math.round(window.innerHeight));

  onStep("Replacing media with placeholders…");
  const mediaReplaced = replaceMedia(doc, pageUrl);

  sanitize(doc);
  injectHeightProbe(doc);

  onStep("Tidying the markup…");
  const html = formatHtml(`<!DOCTYPE html>\n${doc.documentElement.outerHTML}`);
  return { html, finalUrl: pageUrl, sheetsInlined, mediaReplaced, viewportLocked };
}

/* --------------------------------------------------------- local file ---- */

export interface FileImportOutcome {
  /** Pretty-printed full document — stored as `SalesPage.html`. */
  html: string;
  mediaReplaced: number;
  /** Height viewport units (100vh & friends) locked to pixels. */
  viewportLocked: number;
}

/**
 * "Upload HTML file" — the document half of the import pipeline with nothing
 * to fetch: media becomes placeholder art (originals parked on
 * `data-storesy-src`), the dangerous surface is stripped, viewport heights
 * lock to the editor window, the height probe goes in, and the markup is
 * pretty-printed like every other import.
 *
 * Stylesheets stay exactly as the file wrote them: with no page address
 * there is nothing to resolve a relative `<link>` against, and an absolute
 * one loads inside the frame precisely as it did on disk. The result is
 * always a complete document — DOMParser builds the whole tree — so it
 * frames and badges like any import.
 */
export function importFileToHtml(rawHtml: string): FileImportOutcome {
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");

  // No address to resolve anchors against; `target="_blank"` still keeps
  // every link click out of the document itself.
  for (const base of doc.querySelectorAll("base")) base.remove();
  const base = doc.createElement("base");
  base.setAttribute("target", "_blank");
  (doc.head ?? doc.documentElement).prepend(base);

  const viewportLocked = lockViewportHeights(doc, Math.round(window.innerHeight));
  // Page address "" — absolute URLs keep their meaning, relative ones fall
  // through to `none`, exactly what an unresolvable local path deserves.
  const mediaReplaced = replaceMedia(doc, "");
  sanitize(doc);
  injectHeightProbe(doc);

  const html = formatHtml(`<!DOCTYPE html>\n${doc.documentElement.outerHTML}`);
  return { html, mediaReplaced, viewportLocked };
}
