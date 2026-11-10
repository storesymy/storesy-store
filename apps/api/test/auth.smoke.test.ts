import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * Uptime canary: exercises the full request path (router -> middleware ->
 * controller -> D1 -> Durable Objects -> cookie) so a broken deploy fails CI
 * instead of failing production. Per repo policy this is the only test file.
 */
describe("critical request path", () => {
  it("serves health without touching the session layer", async () => {
    const response = await SELF.fetch("http://example.com/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
  });

  it("completes sign-up -> session read -> logout -> signed-out", async () => {
    const email = `smoke-${crypto.randomUUID()}@example.com`;

    const signup = await SELF.fetch("http://example.com/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Smoke Tester", email, password: "correct horse battery" }),
    });
    expect(signup.status).toBe(201);
    const setCookie = signup.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    const cookie = (setCookie as string).split(";")[0] as string;

    const me = await SELF.fetch("http://example.com/api/me", { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);
    const body = (await me.json()) as { user: { email: string } };
    expect(body.user.email).toBe(email);

    const logout = await SELF.fetch("http://example.com/api/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(logout.status).toBe(204);

    const meAfterLogout = await SELF.fetch("http://example.com/api/me", {
      headers: { Cookie: cookie },
    });
    expect(meAfterLogout.status).toBe(401);
  });

  it("answers unknown routes and wrong verbs without crashing", async () => {
    expect((await SELF.fetch("http://example.com/api/nope")).status).toBe(404);
    expect((await SELF.fetch("http://example.com/api/health", { method: "DELETE" })).status).toBe(
      405,
    );
  });

  it("serves the products catalog to any signed-in account (rows are install-wide)", async () => {
    // Signed-out is rejected outright.
    expect((await SELF.fetch("http://example.com/api/products")).status).toBe(401);

    // Sign up to get a session, then exercise the full products path.
    const email = `smoke-products-${crypto.randomUUID()}@example.com`;
    const signup = await SELF.fetch("http://example.com/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Smoke Tester", email, password: "correct horse battery" }),
    });
    expect(signup.status).toBe(201);
    const cookie = (signup.headers.get("set-cookie") as string).split(";")[0] as string;

    const created = await SELF.fetch("http://example.com/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "Smoke Product", type: "digital" }),
    });
    expect(created.status).toBe(201);
    const product = (await created.json()) as { id: string; code: string };
    expect(product.id).toMatch(/^prd-/);
    expect(product.code).toMatch(/^PRD-\d{4}$/);

    const list = await SELF.fetch("http://example.com/api/products", { headers: { Cookie: cookie } });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { products: Array<{ id: string }> };
    expect(body.products.some((row) => row.id === product.id)).toBe(true);

    // Detail by uuid: found for a real id, 404 for an unknown one.
    const detail = await SELF.fetch(`http://example.com/api/products/${product.id}`, {
      headers: { Cookie: cookie },
    });
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { code: string }).code).toBe(product.code);

    const missing = await SELF.fetch(
      "http://example.com/api/products/prd-00000000-0000-7000-8000-000000000000",
      { headers: { Cookie: cookie } },
    );
    expect(missing.status).toBe(404);

    // Edit path: PATCH writes every form field, rejects unknown ids and
    // unauthenticated callers, and keeps money as integer cents.
    const patched = await SELF.fetch(`http://example.com/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: "Smoke Product Renamed",
        type: "physical",
        description: "Long-form product copy.",
        sku: "SKU-77",
        price: 1250,
        discountPrice: 990,
        status: "draft",
        weightKg: 1.25,
        widthCm: 10,
        heightCm: 20,
        lengthCm: 30,
        downloadLinks: [
          "https://files.example.com/ebook.pdf",
          "https://mirror.example.com/ebook.pdf",
        ],
        fulfilment: { shipment: true, download: true },
      }),
    });
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as {
      name: string;
      type: string;
      description: string;
      sku: string;
      price: number;
      discountPrice: number | null;
      status: string;
      weightKg: number | null;
      widthCm: number | null;
      heightCm: number | null;
      lengthCm: number | null;
      downloadLinks: string[];
      fulfilment: { shipment: boolean; download: boolean };
    };
    expect(patchedBody.name).toBe("Smoke Product Renamed");
    expect(patchedBody.type).toBe("physical");
    expect(patchedBody.description).toBe("Long-form product copy.");
    expect(patchedBody.sku).toBe("SKU-77");
    expect(patchedBody.price).toBe(1250); // RM 12.50 survives as integer cents
    expect(patchedBody.discountPrice).toBe(990); // RM 9.90 discount rides along
    expect(patchedBody.status).toBe("draft");
    expect(patchedBody.weightKg).toBe(1.25);
    expect(patchedBody.widthCm).toBe(10);
    expect(patchedBody.heightCm).toBe(20);
    expect(patchedBody.lengthCm).toBe(30);
    expect(patchedBody.downloadLinks).toEqual([
      "https://files.example.com/ebook.pdf",
      "https://mirror.example.com/ebook.pdf",
    ]);
    expect(patchedBody.fulfilment.shipment).toBe(true);
    expect(patchedBody.fulfilment.download).toBe(true);

    // Fulfilment guard: switching every channel off is rejected.
    const patchNoFulfilment = await SELF.fetch(`http://example.com/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ fulfilment: { shipment: false, download: false } }),
    });
    expect(patchNoFulfilment.status).toBe(422);

    // Clearing a shipment field back to unset (null) round-trips too.
    const patchClear = await SELF.fetch(`http://example.com/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ weightKg: null, discountPrice: null }),
    });
    expect(patchClear.status).toBe(200);
    const clearedBody = (await patchClear.json()) as {
      weightKg: number | null;
      discountPrice: number | null;
    };
    expect(clearedBody.weightKg).toBeNull();
    expect(clearedBody.discountPrice).toBeNull(); // sale cleared back to none

    // Money guard: negative prices fail validation instead of reaching data.
    const patchBadPrice = await SELF.fetch(`http://example.com/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ price: -100 }),
    });
    expect(patchBadPrice.status).toBe(422);

    // Discount guards: a negative discount is rejected, and one that doesn't
    // undercut the price can't be saved alongside it.
    const patchBadDiscount = await SELF.fetch(`http://example.com/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ discountPrice: -100 }),
    });
    expect(patchBadDiscount.status).toBe(422);

    const patchDiscountNotLower = await SELF.fetch(
      `http://example.com/api/products/${product.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ price: 1250, discountPrice: 1250 }),
      },
    );
    expect(patchDiscountNotLower.status).toBe(422);

    // Inventory: whole units round-trip; fractional or negative never store.
    const patchStock = await SELF.fetch(`http://example.com/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ stock: 12 }),
    });
    expect(patchStock.status).toBe(200);
    expect(((await patchStock.json()) as { stock: number }).stock).toBe(12);

    const patchNegativeStock = await SELF.fetch(`http://example.com/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ stock: -1 }),
    });
    expect(patchNegativeStock.status).toBe(422);

    const patchFractionalStock = await SELF.fetch(`http://example.com/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ stock: 1.5 }),
    });
    expect(patchFractionalStock.status).toBe(422);

    // Digital link guard: half-typed links are rejected, not stored.
    const patchBadLink = await SELF.fetch(`http://example.com/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ downloadLinks: ["files.example.com"] }),
    });
    expect(patchBadLink.status).toBe(422);

    // Link cap guard: beyond 10 links fails validation.
    const patchManyLinks = await SELF.fetch(`http://example.com/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ downloadLinks: Array.from({ length: 11 }, (_, i) => `https://x.example/f${i}`) }),
    });
    expect(patchManyLinks.status).toBe(422);

    // Images: upload stores bytes in R2 and hands back a stored path.
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      ),
      (char) => char.charCodeAt(0),
    );
    const upload = await SELF.fetch(`http://example.com/api/images?product=${product.id}`, {
      method: "POST",
      headers: { "Content-Type": "image/png", Cookie: cookie },
      body: png,
    });
    expect(upload.status).toBe(201);
    const { path: imagePath } = (await upload.json()) as { path: string };
    expect(imagePath).toMatch(/^products\/prd-[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/);

    // Served back publicly — no cookie — and byte-identical.
    const served = await SELF.fetch(`http://example.com/api/images/${imagePath}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(png);

    // Upload guards: signed out, ghost product, not an image.
    const uploadSignedOut = await SELF.fetch(
      `http://example.com/api/images?product=${product.id}`,
      { method: "POST", headers: { "Content-Type": "image/png" }, body: png },
    );
    expect(uploadSignedOut.status).toBe(401);

    const uploadGhost = await SELF.fetch(
      "http://example.com/api/images?product=prd-00000000-0000-7000-8000-000000000000",
      { method: "POST", headers: { "Content-Type": "image/png", Cookie: cookie }, body: png },
    );
    expect(uploadGhost.status).toBe(404);

    const uploadText = await SELF.fetch(`http://example.com/api/images?product=${product.id}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", Cookie: cookie },
      body: "not an image",
    });
    expect(uploadText.status).toBe(422);

    // A second upload gives a distinct path; both round-trip through PATCH.
    const upload2 = await SELF.fetch(`http://example.com/api/images?product=${product.id}`, {
      method: "POST",
      headers: { "Content-Type": "image/png", Cookie: cookie },
      body: png,
    });
    expect(upload2.status).toBe(201);
    const { path: secondPath } = (await upload2.json()) as { path: string };
    expect(secondPath).not.toBe(imagePath);

    const patchImages = await SELF.fetch(`http://example.com/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ featured: imagePath, gallery: [secondPath] }),
    });
    expect(patchImages.status).toBe(200);
    const imagesBody = (await patchImages.json()) as {
      featured: string | null;
      gallery: string[];
    };
    expect(imagesBody.featured).toBe(imagePath);
    expect(imagesBody.gallery).toEqual([secondPath]);

    // Junk paths are rejected, never stored.
    const patchBadPath = await SELF.fetch(`http://example.com/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ featured: "../../etc/passwd" }),
    });
    expect(patchBadPath.status).toBe(422);

    // Delete-on-save: dropping both paths removes the stored objects too.
    const patchClearImages = await SELF.fetch(`http://example.com/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ featured: null, gallery: [] }),
    });
    expect(patchClearImages.status).toBe(200);
    expect(
      ((await patchClearImages.json()) as { featured: string | null }).featured,
    ).toBeNull();
    expect((await SELF.fetch(`http://example.com/api/images/${imagePath}`)).status).toBe(404);
    expect((await SELF.fetch(`http://example.com/api/images/${secondPath}`)).status).toBe(404);

    // Download files: content addressed — same bytes return the same path.
    const pdf = new TextEncoder().encode(`%PDF-1.4 storesy smoke ${"x".repeat(64)}`);
    const fileUpload = await SELF.fetch(`http://example.com/api/files?product=${product.id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": "guide.pdf",
        Cookie: cookie,
      },
      body: pdf,
    });
    expect(fileUpload.status).toBe(201);
    const entry = (await fileUpload.json()) as { path: string; name: string; size: number };
    expect(entry.path).toMatch(/^downloads\/prd-[0-9a-f-]{36}\/[0-9a-f]{64}\.pdf$/);
    expect(entry.name).toBe("guide.pdf");
    expect(entry.size).toBe(pdf.byteLength);

    // Same bytes under another name: same path — the bucket never gets a copy.
    const fileUploadAgain = await SELF.fetch(
      `http://example.com/api/files?product=${product.id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-File-Name": "guide (copy).pdf",
          Cookie: cookie,
        },
        body: pdf,
      },
    );
    const entryAgain = (await fileUploadAgain.json()) as { path: string };
    expect(entryAgain.path).toBe(entry.path);

    // Stored bytes are the owner's: 401 signed out, attachment when fetched.
    expect((await SELF.fetch(`http://example.com/api/files/${entry.path}`)).status).toBe(401);
    const fileServed = await SELF.fetch(`http://example.com/api/files/${entry.path}`, {
      headers: { Cookie: cookie },
    });
    expect(fileServed.status).toBe(200);
    expect(fileServed.headers.get("content-disposition")).toContain("guide.pdf");
    expect(fileServed.headers.get("content-type")).toBe("application/octet-stream");
    expect(new Uint8Array(await fileServed.arrayBuffer())).toEqual(pdf);

    // Guards: ghost product, empty body, traversal in the filename.
    const fileGhost = await SELF.fetch(
      "http://example.com/api/files?product=prd-00000000-0000-7000-8000-000000000000",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-File-Name": "x.pdf",
          Cookie: cookie,
        },
        body: pdf,
      },
    );
    expect(fileGhost.status).toBe(404);

    const fileEmpty = await SELF.fetch(`http://example.com/api/files?product=${product.id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": "x.pdf",
        Cookie: cookie,
      },
      body: new Uint8Array(0),
    });
    expect(fileEmpty.status).toBe(400);

    const fileTraversal = await SELF.fetch(`http://example.com/api/files?product=${product.id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": "../../evil.PDF",
        Cookie: cookie,
      },
      body: new TextEncoder().encode("different bytes entirely"),
    });
    expect(fileTraversal.status).toBe(201);
    const traversal = (await fileTraversal.json()) as { path: string; name: string };
    expect(traversal.path).toMatch(/^downloads\/prd-[0-9a-f-]{36}\/[0-9a-f]{64}\.pdf$/);
    expect(traversal.name).toBe("evil.PDF");

    // PATCH round-trip: entries persist; duplicate or junk paths are rejected.
    const patchFiles = await SELF.fetch(`http://example.com/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        downloadFiles: [
          entry,
          { path: traversal.path, name: traversal.name, size: 23 },
        ],
      }),
    });
    expect(patchFiles.status).toBe(200);
    const filesBody = (await patchFiles.json()) as { downloadFiles: { path: string }[] };
    expect(filesBody.downloadFiles.map((file) => file.path)).toEqual([
      entry.path,
      traversal.path,
    ]);

    const patchDupFile = await SELF.fetch(`http://example.com/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ downloadFiles: [entry, entry] }),
    });
    expect(patchDupFile.status).toBe(422);

    const patchBadFilePath = await SELF.fetch(`http://example.com/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ downloadFiles: [{ path: "downloads/evil", name: "x", size: 1 }] }),
    });
    expect(patchBadFilePath.status).toBe(422);

    // Delete-on-save: dropping both entries removes the stored bytes too.
    const patchClearFiles = await SELF.fetch(`http://example.com/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ downloadFiles: [] }),
    });
    expect(patchClearFiles.status).toBe(200);
    const clearedFiles = (await patchClearFiles.json()) as { downloadFiles: unknown[] };
    expect(clearedFiles.downloadFiles).toEqual([]);
    expect(
      (await SELF.fetch(`http://example.com/api/files/${entry.path}`, { headers: { Cookie: cookie } }))
        .status,
    ).toBe(404);
    expect(
      (
        await SELF.fetch(`http://example.com/api/files/${traversal.path}`, {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(404);

    const patchMissing = await SELF.fetch(
      "http://example.com/api/products/prd-00000000-0000-7000-8000-000000000000",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ name: "Ghost" }),
      },
    );
    expect(patchMissing.status).toBe(404);

    const patchUnauthed = await SELF.fetch(`http://example.com/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Nope" }),
    });
    expect(patchUnauthed.status).toBe(401);
  });
});
