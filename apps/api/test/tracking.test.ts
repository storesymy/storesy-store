import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { injectTracking } from "../src/services/tracking.service";

/**
 * Tracking on the public page: the merchant selects Tracking integrations on
 * the page, and `/<slug>` carries their snippets at the very end of the body.
 * The snippets are built from non-secret configuration only, ids are shape-
 * checked before they touch markup, and every read is fresh (no re-publish
 * needed when a pixel id changes).
 */

const ORIGIN = "http://example.com";

let session: Promise<string> | null = null;
function sharedSession(): Promise<string> {
  session ??= (async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Tracking Tester",
        email: `tracking-${crypto.randomUUID()}@example.com`,
        password: "correct horse battery",
      }),
    });
    expect(response.status).toBe(201);
    return (response.headers.get("set-cookie") as string).split(";")[0] as string;
  })();
  return session;
}

const jsonHeaders = (cookie: string) => ({ "Content-Type": "application/json", Cookie: cookie });

interface PageStub {
  id: string;
  slug: string;
}

/** A page whose stored document is exactly this markup — placement is visible. */
async function createPage(cookie: string, slug: string): Promise<PageStub> {
  const document =
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Tracking</title></head>" +
    "<body><p id=\"marker\">Hello</p></body></html>";
  const response = await SELF.fetch(`${ORIGIN}/api/salespages`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ name: "Tracking Page", slug, document }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as PageStub;
}

async function addIntegration(
  cookie: string,
  provider: string,
  fields: Record<string, string>,
): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/api/integrations`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ provider, name: `Tracking ${provider}`, fields }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { uuid: string }).uuid;
}

async function selectTrackings(cookie: string, pageId: string, trackings: string[]): Promise<string[]> {
  const response = await SELF.fetch(`${ORIGIN}/api/salespages/${pageId}`, {
    method: "PATCH",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ trackings }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { trackings: string[] }).trackings;
}

async function fetchPage(slug: string): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/${slug}`);
  expect(response.status).toBe(200);
  return response.text();
}

describe("tracking snippets on the public page", () => {
  it("appends every selected tracker at the end of the body, in selection order", async () => {
    const cookie = await sharedSession();
    const page = await createPage(cookie, "tracking-all");
    const gtm = await addIntegration(cookie, "google-tag-manager", { containerId: "GTM-ABC1234" });
    const meta = await addIntegration(cookie, "meta-pixel", { pixelId: "123456789012345" });
    const tiktok = await addIntegration(cookie, "tiktok-pixel", { pixelId: "C4ABCDEFGH" });
    const saved = await selectTrackings(cookie, page.id, [gtm, meta, tiktok]);
    expect(saved).toEqual([gtm, meta, tiktok]);

    const html = await fetchPage("tracking-all");
    expect(html).toContain("Storesy tracking · Google Tag Manager (GTM-ABC1234)");
    expect(html).toContain("Storesy tracking · Meta Pixel (123456789012345)");
    expect(html).toContain("gtm.js?id='+i+dl");
    expect(html).toContain("fbq('init','123456789012345')");
    expect(html).toContain("ttq.load('C4ABCDEFGH')");

    // Near the end of the body: after the page's own markup, before </body>.
    const marker = html.indexOf('id="marker"');
    const closing = html.search(/<\/body>/i);
    for (const needle of ["googletagmanager.com/gtm.js", "connect.facebook.net", "analytics.tiktok.com"]) {
      const at = html.indexOf(needle);
      expect(at).toBeGreaterThan(marker);
      expect(at).toBeLessThan(closing);
    }
    // Selection order is preserved.
    expect(html.indexOf("googletagmanager.com/gtm.js")).toBeLessThan(
      html.indexOf("connect.facebook.net"),
    );
    expect(html.indexOf("connect.facebook.net")).toBeLessThan(
      html.indexOf("analytics.tiktok.com"),
    );
  });

  it("adds nothing when no tracker is selected", async () => {
    const cookie = await sharedSession();
    await createPage(cookie, "tracking-none");
    const html = await fetchPage("tracking-none");
    expect(html).not.toContain("Storesy tracking");
    expect(html).not.toContain("googletagmanager.com");
    expect(html).not.toContain("connect.facebook.net");
  });

  it("drops a tracker whose integration was deleted, without a re-save", async () => {
    const cookie = await sharedSession();
    const page = await createPage(cookie, "tracking-stale");
    const gtm = await addIntegration(cookie, "google-tag-manager", { containerId: "GTM-STALE12" });
    const tiktok = await addIntegration(cookie, "tiktok-pixel", { pixelId: "C4STALE123" });
    await selectTrackings(cookie, page.id, [gtm, tiktok]);

    // The page row still points at the deleted row; the view skips it.
    const removed = await SELF.fetch(`${ORIGIN}/api/integrations/${gtm}`, {
      method: "DELETE",
      headers: jsonHeaders(cookie),
    });
    expect(removed.status).toBe(204);

    const html = await fetchPage("tracking-stale");
    expect(html).not.toContain("googletagmanager.com");
    expect(html).toContain("ttq.load('C4STALE123')");
  });

  it("refuses ids that aren't valid for their provider — nothing reaches the markup", async () => {
    const cookie = await sharedSession();
    const page = await createPage(cookie, "tracking-hostile");
    const hostile = await addIntegration(cookie, "meta-pixel", {
      pixelId: '1234567");alert(1);//',
    });
    await selectTrackings(cookie, page.id, [hostile]);

    const html = await fetchPage("tracking-hostile");
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("facebook.com/tr");
    expect(html).not.toContain("Storesy tracking");
  });

  it("ignores a non-tracking integration pointed at by the page", async () => {
    const cookie = await sharedSession();
    const page = await createPage(cookie, "tracking-wrong-kind");
    const billplz = await addIntegration(cookie, "billplz", {
      host: "billplz-sandbox.com",
      apiKey: "some-secret-key",
      collectionId: "abc12345",
    });
    await selectTrackings(cookie, page.id, [billplz]);

    const html = await fetchPage("tracking-wrong-kind");
    expect(html).not.toContain("billplz");
    expect(html).not.toContain("Storesy tracking");
  });

  it("appends after the markup when a document has no closing body tag", () => {
    const out = injectTracking("<section>bare</section>", "<script>x()</script>");
    expect(out.startsWith("<section>bare</section>")).toBe(true);
    expect(out).toContain("<script>x()</script>");
  });
});
