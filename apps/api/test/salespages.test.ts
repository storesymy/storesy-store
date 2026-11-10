import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * Sales pages store their HTML as static R2 objects; the D1 row records only
 * the path (data.html). These tests pin that contract end to end — the table
 * never carrying markup, hydration coming back out of the bucket, the public
 * signed-out read, slug uniqueness as a 409, and the batched visit counter
 * (the mechanism that keeps a viral page from turning views into D1 writes).
 */

const ORIGIN = "http://example.com";

/**
 * One account for the whole file: signups are rate-limited per client IP, and
 * every test in the pool shares one. Slugs stay unique per test, so the rows
 * never collide.
 */
let session: Promise<string> | null = null;
function sharedSession(): Promise<string> {
  session ??= (async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Sales Tester",
        email: `salespages-${crypto.randomUUID()}@example.com`,
        password: "correct horse battery",
      }),
    });
    expect(response.status).toBe(201);
    return (response.headers.get("set-cookie") as string).split(";")[0] as string;
  })();
  return session;
}

interface CreatedPage {
  id: string;
  slug: string;
  status: string;
}

async function createPage(cookie: string, slug: string): Promise<CreatedPage> {
  const response = await SELF.fetch(`${ORIGIN}/api/salespages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name: "Summer Mega Sale", slug }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as CreatedPage;
}

async function patch(
  cookie: string,
  uuid: string,
  body: unknown,
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/salespages/${uuid}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
}

/** JSON headers + the API's error envelope (shared shape across resources). */
const jsonHeaders = (cookie: string) => ({ "Content-Type": "application/json", Cookie: cookie });
interface ErrorEnvelope {
  error: { code: string; message: string; fields?: Record<string, string> };
}

/** Direct row read — the only way to prove markup never enters the table. */
async function rawData(uuid: string): Promise<{ data: string }> {
  const row = await env.DB.prepare("SELECT data FROM sales_pages WHERE uuid = ?")
    .bind(uuid)
    .first<{ data: string }>();
  if (!row) throw new Error("row vanished");
  return row;
}

function visitStub(uuid: string) {
  return env.VISIT_COUNTER.get(env.VISIT_COUNTER.idFromName(`visit:${uuid}`));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("sales pages API", () => {
  it("requires a session for every studio route", async () => {
    const list = await SELF.fetch(`${ORIGIN}/api/salespages`);
    expect(list.status).toBe(401);
    const create = await SELF.fetch(`${ORIGIN}/api/salespages`, { method: "POST" });
    expect(create.status).toBe(401);
    const patchResponse = await SELF.fetch(`${ORIGIN}/api/salespages/spg-x`, { method: "PATCH" });
    expect(patchResponse.status).toBe(401);
    const remove = await SELF.fetch(`${ORIGIN}/api/salespages/spg-x`, { method: "DELETE" });
    expect(remove.status).toBe(401);
  });

  it("creates a page with an spg- uuid and 409s a duplicate slug", async () => {
    const cookie = await sharedSession();
    const page = await createPage(cookie, "summer-mega-sale");
    expect(page.id).toMatch(
      /^spg-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(page.status).toBe("open");

    const duplicate = await SELF.fetch(`${ORIGIN}/api/salespages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "Another Page", slug: "summer-mega-sale" }),
    });
    expect(duplicate.status).toBe(409);
    const body = (await duplicate.json()) as { error: { code: string } };
    expect(body.error.code).toBe("slug_taken");
  });

  it("stores documents in R2 and records only their paths on the row", async () => {
    const cookie = await sharedSession();
    const page = await createPage(cookie, "html-as-file");
    const markup = "<!doctype html><html><body><h1>Imported</h1></body></html>";

    const saved = await patch(cookie, page.id, { html: { code: markup } });
    expect(saved.status).toBe(200);

    // The object exists in the bucket as HTML…
    const path = `salespages/${page.id}/code.html`;
    const object = await env.IMAGES.head(path);
    expect(object).not.toBeNull();
    expect(object?.httpMetadata?.contentType).toContain("text/html");

    // …and the row carries the path only — no markup ever lands in D1.
    const row = await rawData(page.id);
    expect(row.data).not.toContain("Imported");
    expect(JSON.parse(row.data).html.code).toBe(path);

    // The detail read hydrates the document back out of R2.
    const detail = await SELF.fetch(`${ORIGIN}/api/salespages/${page.id}`, {
      headers: { Cookie: cookie },
    });
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as { htmlByType: Record<string, string> };
    expect(body.htmlByType.code).toBe(markup);
  });

  it("clearing a slot deletes the object and drops the path", async () => {
    const cookie = await sharedSession();
    const page = await createPage(cookie, "clear-slot");
    await patch(cookie, page.id, { html: { code: "<p>temp</p>" } });

    const cleared = await patch(cookie, page.id, { html: { code: null } });
    expect(cleared.status).toBe(200);
    expect(await env.IMAGES.head(`salespages/${page.id}/code.html`)).toBeNull();

    const row = await rawData(page.id);
    expect(JSON.parse(row.data).html).not.toHaveProperty("code");

    const detail = await SELF.fetch(`${ORIGIN}/api/salespages/${page.id}`, {
      headers: { Cookie: cookie },
    });
    const body = (await detail.json()) as { htmlByType: Record<string, string> };
    expect(body.htmlByType.code).toBeUndefined();
  });

  it("serves the public slug read signed out, closed pages included", async () => {
    const cookie = await sharedSession();
    const page = await createPage(cookie, "public-page");
    await patch(cookie, page.id, { html: { code: "<b>public markup</b>" } });

    const publicRead = await SELF.fetch(`${ORIGIN}/api/salespages/public/public-page`);
    expect(publicRead.status).toBe(200);
    const body = (await publicRead.json()) as {
      status: string;
      htmlByType: Record<string, string>;
    };
    expect(body.status).toBe("open");
    expect(body.htmlByType.code).toBe("<b>public markup</b>");

    const unknown = await SELF.fetch(`${ORIGIN}/api/salespages/public/no-such-page`);
    expect(unknown.status).toBe(404);

    // Closed pages still return their row — the SPA renders the paused card.
    await patch(cookie, page.id, { status: "closed" });
    const closed = await SELF.fetch(`${ORIGIN}/api/salespages/public/public-page`);
    expect(closed.status).toBe(200);
    expect(((await closed.json()) as { status: string }).status).toBe("closed");
  });

  it("rejects documents over the 3 MB ceiling", async () => {
    const cookie = await sharedSession();
    const page = await createPage(cookie, "oversized");
    const oversized = "a".repeat(3_000_001);
    const response = await patch(cookie, page.id, { html: { code: oversized } });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { fields?: Record<string, string> } };
    expect(body.error.fields?.["html.code"]).toContain("too large");
  });

  it("409s a slug rename onto an existing page", async () => {
    const cookie = await sharedSession();
    await createPage(cookie, "taken-slug");
    const second = await createPage(cookie, "free-slug");

    const response = await patch(cookie, second.id, { slug: "taken-slug" });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "slug_taken",
    );
  });

  it("batches visits additively and never lets a save clobber them", async () => {
    const cookie = await sharedSession();
    const page = await createPage(cookie, "visit-counter");
    const stub = visitStub(page.id);

    // Two visits land on the DO; one flush = one additive D1 update.
    await stub.hit(page.id);
    await stub.hit(page.id);
    await stub.flush();
    expect(JSON.parse((await rawData(page.id)).data).visits).toBe(2);

    // A second batch adds — the counter never resets between flushes.
    await stub.hit(page.id);
    await stub.flush();
    const afterFlushes = JSON.parse((await rawData(page.id)).data).visits;
    expect(afterFlushes).toBe(3);

    // A page save rewrites data wholesale but must keep the counted visits.
    const saved = await patch(cookie, page.id, { name: "Renamed Page" });
    expect(saved.status).toBe(200);
    expect(JSON.parse((await rawData(page.id)).data).visits).toBe(afterFlushes);
  });

  it("counts a public view through the counter DO", async () => {
    const cookie = await sharedSession();
    const page = await createPage(cookie, "counted-view");
    const stub = visitStub(page.id);

    const response = await SELF.fetch(`${ORIGIN}/api/salespages/public/counted-view`);
    expect(response.status).toBe(200);

    // The view rides waitUntil: poll the flush until the batch lands.
    let visits = 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await stub.flush();
      visits = JSON.parse((await rawData(page.id)).data).visits as number;
      if (visits > 0) break;
      await sleep(25);
    }
    expect(visits).toBe(1);
  });
});

/**
 * The public storefront route: `/<slug>` serves the standalone document the
 * SPA stored in R2 at save time — plain HTML, signed out, counted. No page or
 * no document degrades to a plain shell, never JSON and never a blank 500.
 */
describe("public /<slug> documents", () => {
  const DOC =
    '<!doctype html><html><head><title>SEO Title · Shop</title>' +
    '<meta property="og:title" content="SEO Title"></head>' +
    "<body><h1>MARKER-STATIC</h1></body></html>";

  it("serves the stored document as HTML and records only its path", async () => {
    const cookie = await sharedSession();
    const page = await createPage(cookie, "plain-html-page");
    const saved = await patch(cookie, page.id, { document: DOC });
    expect(saved.status).toBe(200);

    // The object lives in the bucket…
    const object = await env.IMAGES.head(`salespages/${page.id}/page.html`);
    expect(object).not.toBeNull();
    expect(object?.httpMetadata?.contentType).toContain("text/html");

    // …and the row carries the path only — markup never lands in D1.
    const row = await rawData(page.id);
    expect(row.data).not.toContain("MARKER-STATIC");
    expect(JSON.parse(row.data).pagePath).toBe(`salespages/${page.id}/page.html`);

    // The route answers with the document itself: HTML, no session, no JS.
    const response = await SELF.fetch(`${ORIGIN}/plain-html-page`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const html = await response.text();
    expect(html).toContain("<title>SEO Title · Shop</title>");
    expect(html).toContain("MARKER-STATIC");
  });

  it("counts visits through the counter DO, like the JSON read", async () => {
    const cookie = await sharedSession();
    const page = await createPage(cookie, "counted-html-view");
    await patch(cookie, page.id, { document: DOC });
    const stub = visitStub(page.id);

    const response = await SELF.fetch(`${ORIGIN}/counted-html-view`);
    expect(response.status).toBe(200);

    let visits = 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await stub.flush();
      visits = JSON.parse((await rawData(page.id)).data).visits as number;
      if (visits > 0) break;
      await sleep(25);
    }
    expect(visits).toBe(1);
  });

  it("serves a plain shell when no document is stored, and an HTML 404", async () => {
    const cookie = await sharedSession();
    const page = await createPage(cookie, "no-document-yet");

    const response = await SELF.fetch(`${ORIGIN}/no-document-yet`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Summer Mega Sale"); // the fallback shell names the page

    const missing = await SELF.fetch(`${ORIGIN}/no-such-slug-at-all`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("text/html");
    expect(await missing.text()).toContain("Page not found");
  });

  it("clearing the document deletes the object and serves the shell again", async () => {
    const cookie = await sharedSession();
    const page = await createPage(cookie, "clear-public-document");
    await patch(cookie, page.id, { document: DOC });

    const cleared = await patch(cookie, page.id, { document: null });
    expect(cleared.status).toBe(200);
    expect(await env.IMAGES.head(`salespages/${page.id}/page.html`)).toBeNull();

    const row = await rawData(page.id);
    expect(JSON.parse(row.data).pagePath).toBeUndefined();

    const html = await (await SELF.fetch(`${ORIGIN}/clear-public-document`)).text();
    expect(html).not.toContain("MARKER-STATIC");
    expect(html).toContain("Summer Mega Sale");
  });

  it("serves a paused shell for a closed page", async () => {
    const cookie = await sharedSession();
    const page = await createPage(cookie, "closed-page");
    await patch(cookie, page.id, { document: DOC });
    await patch(cookie, page.id, { status: "closed" });

    const response = await SELF.fetch(`${ORIGIN}/closed-page`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).not.toContain("MARKER-STATIC");
    expect(html).toContain("paused");
  });

  it("drops the stored document when the page is deleted", async () => {
    const cookie = await sharedSession();
    const page = await createPage(cookie, "delete-public-document");
    await patch(cookie, page.id, { document: DOC });
    expect(await env.IMAGES.head(`salespages/${page.id}/page.html`)).not.toBeNull();

    const removed = await SELF.fetch(`${ORIGIN}/api/salespages/${page.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(removed.status).toBe(204);
    expect(await env.IMAGES.head(`salespages/${page.id}/page.html`)).toBeNull();
  });

  it("rejects a document over the 3 MB ceiling", async () => {
    const cookie = await sharedSession();
    const page = await createPage(cookie, "oversized-document");
    const response = await patch(cookie, page.id, { document: "a".repeat(3_000_001) });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { fields?: Record<string, string> } };
    expect(body.error.fields?.document).toContain("too large");
  });

  it("stores the document at create so the address works before any edit", async () => {
    const cookie = await sharedSession();
    const response = await SELF.fetch(`${ORIGIN}/api/salespages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "Early Bird", slug: "early-bird-page", document: DOC }),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    expect(await env.IMAGES.head(`salespages/${created.id}/page.html`)).not.toBeNull();

    const html = await (await SELF.fetch(`${ORIGIN}/early-bird-page`)).text();
    expect(html).toContain("MARKER-STATIC");
  });
});

/**
 * The root namespace is shared: the Worker answers page paths directly, the
 * catch-all retires the old `/p/<slug>` shape, and the API prefix must stay
 * in its own envelope. These guard app availability — a route table where
 * `/:slug` or `/*` shadows an endpoint would take the studio down.
 */
describe("root routing", () => {
  it("retires the old /p/<slug> shape with a branded 404, not a redirect", async () => {
    const cookie = await sharedSession();
    await createPage(cookie, "retired-shape");

    const retired = await SELF.fetch(`${ORIGIN}/p/retired-shape`);
    expect(retired.status).toBe(404);
    expect(retired.headers.get("content-type")).toContain("text/html");
    expect(await retired.text()).toContain("Page not found");

    const deep = await SELF.fetch(`${ORIGIN}/not/a/page`);
    expect(deep.status).toBe(404);
    expect(deep.headers.get("content-type")).toContain("text/html");
  });

  it("keeps unknown paths under /api in the JSON envelope", async () => {
    // A typo'd endpoint must not hand JSON.parse an HTML document.
    const missing = await SELF.fetch(`${ORIGIN}/api/no-such-endpoint`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("application/json");
    const body = (await missing.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  it("refuses a slug the app owns and still routes the app's own paths", async () => {
    const cookie = await sharedSession();
    const reserved = await SELF.fetch(`${ORIGIN}/api/salespages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "Login", slug: "login" }),
    });
    expect(reserved.status).toBe(422);
    const body = (await reserved.json()) as { error: { code: string; fields?: Record<string, string> } };
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.fields?.slug).toContain("belongs to the app");

    // Registered before `/:slug` and the catch-all — neither may shadow it.
    const health = await SELF.fetch(`${ORIGIN}/api/health`);
    expect(health.status).toBe(200);
    expect(health.headers.get("content-type")).toContain("application/json");
  });

  it("stores the checkout's email sender and trackings (brand-distinct, self-healing)", async () => {
    const cookie = await sharedSession();
    const page = await createPage(cookie, `es-${crypto.randomUUID().slice(0, 8)}`);
    const sender = "itg-0199f3c2-0000-7000-8000-0000000000e1";
    const readPage = async () => {
      const res = await SELF.fetch(`${ORIGIN}/api/salespages/${page.id}`, {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
      return (await res.json()) as { emailSender: string | null; trackings: string[] };
    };
    const createRow = async (provider: string, name: string, fields: Record<string, string>) => {
      const res = await SELF.fetch(`${ORIGIN}/api/integrations`, {
        method: "POST",
        headers: jsonHeaders(cookie),
        body: JSON.stringify({ provider, name, fields }),
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { uuid: string }).uuid;
    };

    // Fresh page: no sender, no trackings.
    const initial = await readPage();
    expect(initial.emailSender).toBeNull();
    expect(initial.trackings).toEqual([]);

    // Real integration rows: two of the SAME brand (Meta) + one TikTok.
    const meta1 = await createRow("meta-pixel", "Meta One", { pixelId: "1111111111" });
    const meta2 = await createRow("meta-pixel", "Meta Two", { pixelId: "2222222222" });
    const tok = await createRow("tiktok-pixel", "TikTok One", { pixelId: "3333333333" });
    const trackings = [meta1, tok];

    try {
      // Different brands save, in the response AND the stored data blob.
      const saved = await patch(cookie, page.id, { emailSender: sender, trackings });
      expect(saved.status).toBe(200);
      const savedBody = (await saved.json()) as { emailSender: string; trackings: string[] };
      expect(savedBody.emailSender).toBe(sender);
      expect(savedBody.trackings).toEqual(trackings);
      const raw = JSON.parse((await rawData(page.id)).data) as {
        emailSender?: string;
        trackings?: string[];
      };
      expect(raw.emailSender).toBe(sender);
      expect(raw.trackings).toEqual(trackings);

      // Same brand twice → refused, naming the rule.
      const dupe = await patch(cookie, page.id, { trackings: [meta1, meta2] });
      expect(dupe.status).toBe(422);
      const dupeBody = (await dupe.json()) as ErrorEnvelope;
      expect(dupeBody.error.fields?.trackings).toContain("different brand");

      // Format junk still fails the schema before any lookup.
      expect((await patch(cookie, page.id, { emailSender: "prd-not-a-uuid" })).status).toBe(422);
      expect((await patch(cookie, page.id, { trackings: ["itg-not-a-uuid"] })).status).toBe(422);

      // Omitted keys stay untouched.
      const renamed = await patch(cookie, page.id, { name: "Renamed ES Page" });
      expect(renamed.status).toBe(200);
      const untouched = await readPage();
      expect(untouched.emailSender).toBe(sender);
      expect(untouched.trackings).toEqual(trackings);

      // A deleted tracking row is pruned silently — autosave can never stick
      // on a dangling uuid.
      await SELF.fetch(`${ORIGIN}/api/integrations/${tok}`, {
        method: "DELETE",
        headers: jsonHeaders(cookie),
      });
      const heal = await patch(cookie, page.id, { trackings: [meta1, tok] });
      expect(heal.status).toBe(200);
      expect(((await heal.json()) as { trackings: string[] }).trackings).toEqual([meta1]);

      // Explicit clears wipe.
      const cleared = await patch(cookie, page.id, { emailSender: null, trackings: [] });
      expect(cleared.status).toBe(200);
      const after = await readPage();
      expect(after.emailSender).toBeNull();
      expect(after.trackings).toEqual([]);
    } finally {
      for (const uuid of [meta1, meta2, tok]) {
        await SELF.fetch(`${ORIGIN}/api/integrations/${uuid}`, {
          method: "DELETE",
          headers: jsonHeaders(cookie),
        });
      }
      await SELF.fetch(`${ORIGIN}/api/salespages/${page.id}`, {
        method: "DELETE",
        headers: { Cookie: cookie },
      });
    }
  });

  it("stores the checkout's payment gateway and refuses junk ids", async () => {
    const cookie = await sharedSession();
    const page = await createPage(cookie, `gw-${crypto.randomUUID().slice(0, 8)}`);
    const gateway = "itg-0199f3c2-0000-7000-8000-000000000000";
    const readPage = async () => {
      const res = await SELF.fetch(`${ORIGIN}/api/salespages/${page.id}`, {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
      return (await res.json()) as { paymentGateway: string | null; name: string };
    };

    // A fresh page charges through no gateway.
    expect((await readPage()).paymentGateway).toBeNull();

    // …an `itg-…` uuid saves, in the response AND the stored data blob.
    const saved = await patch(cookie, page.id, { paymentGateway: gateway });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { paymentGateway: string }).paymentGateway).toBe(gateway);
    const raw = JSON.parse((await rawData(page.id)).data) as { paymentGateway?: string };
    expect(raw.paymentGateway).toBe(gateway);

    // Junk ids are refused — same pattern discipline as product ids.
    const junk = await patch(cookie, page.id, { paymentGateway: "prd-not-a-uuid" });
    expect(junk.status).toBe(422);

    // Omitted key leaves the choice untouched; explicit null clears it.
    const renamed = await patch(cookie, page.id, { name: "Renamed GW Page" });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as { paymentGateway: string }).paymentGateway).toBe(gateway);
    const cleared = await patch(cookie, page.id, { paymentGateway: null });
    expect(cleared.status).toBe(200);
    expect((await readPage()).paymentGateway).toBeNull();

    await SELF.fetch(`${ORIGIN}/api/salespages/${page.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
  });
});
