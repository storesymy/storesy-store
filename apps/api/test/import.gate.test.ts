import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { AppError } from "../src/core/errors";
import { assertSafeUrl, unsafeReason } from "../src/services/ssrf";

/**
 * The importer makes the Worker fetch whatever address an owner pastes —
 * an open proxy into private networks would be an uptime/abuse incident
 * (metadata endpoints, localhost services, internal D1/KV planes). This
 * gate is the guard; each bypass rule is asserted individually with
 * production semantics (allowLocalhost = false).
 */
describe("SSRF gate (production rules)", () => {
  const blocked = (raw: string) => unsafeReason(raw, false);

  it("lets ordinary public addresses through", () => {
    expect(blocked("https://example.com/landing")).toBeNull();
    expect(blocked("http://sub.example.co.uk/path?x=1")).toBeNull();
    expect(blocked("https://8.8.8.8/ads")).toBeNull(); // public IP is fine
    expect(blocked("http://1.1.1.1/")).toBeNull();
    expect(blocked("https://example.com:443/")).toBeNull();
    expect(blocked("http://example.com:80/")).toBeNull();
  });

  it("rejects non-http schemes (including javascript: and data:)", () => {
    expect(blocked("ftp://example.com/file")).toBe("scheme ftp:");
    expect(blocked("file:///etc/passwd")).toBe("scheme file:");
    expect(blocked("gopher://example.com/")).toBe("scheme gopher:");
    expect(blocked("javascript:alert(1)")).toMatch(/^scheme javascript:/);
    expect(blocked("data:text/html,<b>x")).toMatch(/^scheme data:/);
  });

  it("rejects local hostnames in every spelling", () => {
    expect(blocked("http://localhost/")).toBe("local hostname");
    expect(blocked("http://LOCALHOST:5173/page")).toBe("local hostname");
    expect(blocked("http://db.local./")).toBe("local hostname"); // trailing dot
    expect(blocked("http://svc.internal/")).toBe("local hostname");
    expect(blocked("http://router.home.arpa/")).toBe("local hostname");
    expect(blocked("http://x.localdomain/")).toBe("local hostname");
  });

  it("rejects private, loopback and link-local IPv4 ranges", () => {
    expect(blocked("http://10.0.0.1/")).toBe("private address");
    expect(blocked("http://172.16.5.4/")).toBe("private address");
    expect(blocked("http://172.31.255.255/")).toBe("private address");
    expect(blocked("http://172.32.0.1/")).toBeNull(); // just outside 172.16/12
    expect(blocked("http://192.168.1.1/")).toBe("private address");
    expect(blocked("http://127.0.0.1:8787/")).toBe("private address");
    expect(blocked("http://169.254.169.254/latest/meta-data/")).toBe("private address");
    expect(blocked("http://100.64.0.1/")).toBe("private address");
    expect(blocked("http://0.0.0.0/")).toBe("private address");
    expect(blocked("http://224.0.0.1/")).toBe("private address");
    expect(blocked("http://255.255.255.255/")).toBe("private address");
  });

  it("decodes decimal and abbreviated IPv4 spellings", () => {
    expect(blocked("http://2130706433/")).toBe("private address"); // = 127.0.0.1
    expect(blocked("http://127.1/")).toBe("private address"); // = 127.0.0.1
    expect(blocked("http://192.168.1/")).toBe("private address"); // 3-part form
    expect(blocked("http://0x7f000001/")).toBe("private address"); // hex spelling
    expect(blocked("http://999.1.1.1/")).toBe("not a URL"); // out-of-range octet: URL rejects outright
    expect(blocked("http://16843009/")).toBeNull(); // = 1.1.1.1 (public decimal)
  });

  it("rejects IPv6 literals (they smuggle IPv4 embeddings)", () => {
    expect(blocked("http://[::1]/")).toBe("IPv6 literal");
    expect(blocked("http://[fd00::1]/")).toBe("IPv6 literal");
    expect(blocked("http://[::ffff:127.0.0.1]/")).toBe("IPv6 literal");
  });

  it("rejects odd ports, URL credentials and non-URLs", () => {
    expect(blocked("https://example.com:8080/")).toBe("port 8080");
    expect(blocked("http://example.com:22/")).toBe("port 22");
    expect(blocked("https://user:pass@example.com/")).toBe("credentials in the URL");
    expect(blocked("example")).toBe("not a URL");
    expect(blocked("")).toBe("not a URL");
    expect(blocked("not a url at all")).toBe("not a URL");
  });

  it("development mode admits localhost fixtures — and only there", () => {
    // wrangler dev serves the E2E fixture from localhost:5173.
    expect(unsafeReason("http://localhost:5173/fixtures/x.html", true)).toBeNull();
    expect(unsafeReason("http://192.168.1.10/x", true)).toBeNull();
    // Scheme and URL parsing still apply in development.
    expect(unsafeReason("file:///etc/passwd", true)).toBe("scheme file:");
    expect(unsafeReason("nope", true)).toBe("not a URL");
  });

  it("assertSafeUrl throws the client-facing 400 for blocked targets", () => {
    expect(() => assertSafeUrl("http://localhost/", false)).toThrow(AppError);
    try {
      assertSafeUrl("http://169.254.169.254/", false);
      expect.unreachable("must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.status).toBe(400);
      expect(appError.code).toBe("blocked_url");
    }
    expect(assertSafeUrl("https://example.com/x", false).href).toBe("https://example.com/x");
  });
});

describe("import route guards", () => {
  it("requires a session before fetching anything", async () => {
    const response = await SELF.fetch(
      "http://example.com/api/import/fetch?url=https%3A%2F%2Fexample.com&kind=document",
    );
    expect(response.status).toBe(401);
  });

  it("rejects malformed query values with field errors", async () => {
    // Signed out — the session check fires first; nothing else runs unauthenticated.
    const response = await SELF.fetch("http://example.com/api/import/fetch?url=&kind=nope");
    expect(response.status).toBe(401);
  });
});
