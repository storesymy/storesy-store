import { AppError } from "../core/errors";

/**
 * SSRF gate for the URL importer. The Worker fetches whatever address the
 * owner pastes, so every fetch — the first request AND each redirect hop —
 * must prove it points at the public web, not at us or at a private network.
 *
 * `unsafeReason` is a pure function returning the rule that fired (or null),
 * so the unit tests can assert each bypass individually. `assertSafeUrl`
 * wraps it in the 400 the client sees.
 */

/** Hostnames that always mean "this machine" / the local LAN. */
const LOCAL_SUFFIXES = ["localhost", "local", "internal", "home.arpa", "localdomain"];

function isPrivateIpv4(u32: number): boolean {
  const a = (u32 >>> 24) & 0xff;
  const b = (u32 >>> 16) & 0xff;
  const c = (u32 >>> 8) & 0xff;
  if (a === 0) return true; // 0.0.0.0/8 — "this network"
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18.0.0/15
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/**
 * Decodes every numeric spelling a browser would resolve as an IPv4 address
 * — "10.0.0.1", "127.1", "2130706433" (decimal) — into the 32-bit value, or
 * null when it doesn't parse as an IP at all.
 */
function decodeIpv4(host: string): number | null {
  if (!/^\d+(\.\d+){0,3}$/.test(host)) return null;
  const parts = host.split(".").map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0)) return null;
  if (parts.length === 1) {
    const value = parts[0] as number;
    return value <= 0xffffffff ? value : null;
  }
  if (parts.length === 2) {
    const [a, b] = parts as [number, number];
    return a <= 0xff && b <= 0xffffff ? (a << 24) | b : null;
  }
  if (parts.length === 3) {
    const [a, b, c] = parts as [number, number, number];
    return a <= 0xff && b <= 0xff && c <= 0xffff ? (a << 24) | (b << 16) | c : null;
  }
  const [a, b, c, d] = parts as [number, number, number, number];
  if (a > 0xff || b > 0xff || c > 0xff || d > 0xff) return null;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

/** Why this address can't be fetched — or null when it's a clean public URL. */
export function unsafeReason(raw: string, allowLocalhost: boolean): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "not a URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return `scheme ${url.protocol}`;
  // Development (wrangler dev) imports fixtures served from localhost — the
  // private-range and port rules would block every local test page. Never
  // true in production; scheme and URL parsing still apply above.
  if (allowLocalhost) return null;

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.length === 0) return "empty host";
  if (host.startsWith("[")) return "IPv6 literal";
  const numeric = decodeIpv4(host);
  if (numeric !== null) {
    if (isPrivateIpv4(numeric >>> 0)) return "private address";
  } else if (/^[\d.]+$/.test(host)) {
    return "numeric host"; // IP-shaped but undecodable — treat as hostile.
  } else if (LOCAL_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    return "local hostname";
  }

  if (url.port && url.port !== "80" && url.port !== "443") return `port ${url.port}`;
  if (url.username || url.password) return "credentials in the URL";
  return null;
}

/** Throws the client-facing 400 when the address fails the gate. */
export function assertSafeUrl(raw: string, allowLocalhost: boolean): URL {
  const reason = unsafeReason(raw, allowLocalhost);
  if (reason) {
    throw new AppError(
      400,
      "blocked_url",
      "That address can't be imported — give a public http:// or https:// page.",
    );
  }
  return new URL(raw);
}
