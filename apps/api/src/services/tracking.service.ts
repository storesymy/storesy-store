import type { IntegrationRow } from "../models/schema";
import * as integrationsRepo from "../models/integrations.repository";

/**
 * Tracking snippets for the public page.
 *
 * The page picks Tracking-category integrations (`trackings` on the page's
 * data); at request time those rows are read again and their provider's
 * snippet is appended just before `</body>` of the stored document. Doing it
 * on the way out — not baked at save — means changing a pixel ID or removing
 * an integration takes effect on the next view, and a page saved by someone
 * without access to integrations still carries what the merchant selected.
 *
 * Only non-secret settings are read here (a container/pixel id). Ids are
 * validated against strict shapes before they touch markup, so a bad or
 * malicious value can't break out of the string it belongs in; an invalid
 * one skips its snippet and leaves the page untouched.
 */

/** GTM container ids: `GTM-XXXXXXX` (letters/digits). */
const GTM_ID = /^GTM-[A-Z0-9]{4,12}$/;
/** Meta pixel ids are numeric. */
const META_ID = /^\d{5,20}$/;
/** TikTok pixel ids are short alphanumerics (`C4…`). */
const TIKTOK_ID = /^[A-Za-z0-9]{6,32}$/;

function gtmSnippet(containerId: string): string {
  return (
    `<!-- Storesy tracking · Google Tag Manager (${containerId}) -->\n` +
    `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});` +
    `var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';` +
    `j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);` +
    `})(window,document,'script','dataLayer','${containerId}');</script>\n` +
    `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${containerId}" ` +
    `height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`
  );
}

function metaSnippet(pixelId: string): string {
  return (
    `<!-- Storesy tracking · Meta Pixel (${pixelId}) -->\n` +
    `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?` +
    `n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;` +
    `n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];` +
    `s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');` +
    `fbq('init','${pixelId}');fbq('track','PageView');</script>\n` +
    `<noscript><img height="1" width="1" style="display:none" ` +
    `src="https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1"/></noscript>`
  );
}

function tiktokSnippet(pixelId: string): string {
  return (
    `<!-- Storesy tracking · Tiktok Pixel (${pixelId}) -->\n` +
    `<script>!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];` +
    `ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias",` +
    `"group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){` +
    `t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};` +
    `for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);` +
    `ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);` +
    `return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";` +
    `ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,` +
    `ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",` +
    `o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];` +
    `a.parentNode.insertBefore(o,a)};ttq.load('${pixelId}');ttq.page();}(window,document,'ttq');</script>`
  );
}

/** The snippet for one integration row, or "" when it isn't a usable tracker. */
function snippetFor(row: IntegrationRow): string {
  const settings = row.data.settings ?? {};
  if (row.provider === "google-tag-manager") {
    const id = (settings.containerId ?? "").trim();
    return GTM_ID.test(id) ? gtmSnippet(id) : "";
  }
  if (row.provider === "meta-pixel") {
    const id = (settings.pixelId ?? "").trim();
    return META_ID.test(id) ? metaSnippet(id) : "";
  }
  if (row.provider === "tiktok-pixel") {
    const id = (settings.pixelId ?? "").trim();
    return TIKTOK_ID.test(id) ? tiktokSnippet(id) : "";
  }
  return "";
}

/**
 * Snippets for the page's selected trackings, in the order they were added.
 * Unknown/deleted rows and non-tracking providers contribute nothing; one bad
 * id never stops the others.
 */
export async function snippetsFor(env: Env, trackings: string[] | undefined): Promise<string> {
  if (!trackings || trackings.length === 0) return "";
  const rows = await integrationsRepo.listIntegrations(env);
  const byUuid = new Map(rows.map((row) => [row.uuid, row]));
  const parts: string[] = [];
  for (const uuid of trackings) {
    const row = byUuid.get(uuid);
    if (!row) continue;
    const snippet = snippetFor(row);
    if (snippet === "") {
      console.warn("tracking_snippet_skipped", { uuid, provider: row.provider });
      continue;
    }
    parts.push(snippet);
  }
  return parts.length === 0 ? "" : `${parts.join("\n")}\n`;
}

/** Put the snippets at the very end of the body, before `</body>`. */
export function injectTracking(html: string, snippets: string): string {
  if (snippets === "") return html;
  const closing = html.search(/<\/body\s*>/i);
  if (closing === -1) return `${html}\n${snippets}`;
  return `${html.slice(0, closing)}${snippets}${html.slice(closing)}`;
}
