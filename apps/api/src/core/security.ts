import { forbidden } from "./errors";

/** Comma-separated allowlist from the WEB_ORIGIN var (SPA origin(s)). */
export function allowedOrigins(env: Env): string[] {
  return env.WEB_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin: string, env: Env): boolean {
  return allowedOrigins(env).includes(origin);
}

/** CORS preflight for the SPA; credentials (cookies) are allowed for allowlisted origins only. */
export function preflight(request: Request, env: Env): Response {
  const origin = request.headers.get("Origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods":
      request.headers.get("Access-Control-Request-Method") ??
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      request.headers.get("Access-Control-Request-Headers") ?? "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
  if (origin && isAllowedOrigin(origin, env)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return new Response(null, { status: 204, headers });
}

/**
 * CSRF guard for state-changing requests: browsers always attach Origin on
 * POST/PUT/PATCH/DELETE, so a mismatching Origin is rejected outright.
 * Requests without an Origin (curl, server-to-server) are allowed.
 *
 * Same-origin is always allowed: the public sales page (`/<slug>`) posts the
 * checkout back to the very host that served it, and that host isn't
 * necessarily the SPA's `WEB_ORIGIN` (a custom storefront domain, for one).
 * A same-origin request carries no cross-site risk — the browser derived it
 * from the response that already ran on that origin.
 */
export function assertOriginAllowed(request: Request, env: Env): void {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const origin = request.headers.get("Origin");
  if (!origin) return;
  if (isSameOrigin(request, origin) || isAllowedOrigin(origin, env)) return;
  throw forbidden("csrf_rejected", "Request origin is not allowed");
}

function isSameOrigin(request: Request, origin: string): boolean {
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

const BASE_SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

/**
 * Applied to every response: CORS for the allowlisted SPA origin, request id,
 * hardening headers, and any Set-Cookie the handler staged on the context.
 */
export function finalize(
  response: Response,
  request: Request,
  env: Env,
  requestId: string,
  pendingCookies: string[] = [],
): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Request-Id", requestId);
  for (const [key, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }

  const origin = request.headers.get("Origin");
  if (origin && isAllowedOrigin(origin, env)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.append("Vary", "Origin");
  }

  for (const cookie of pendingCookies) headers.append("Set-Cookie", cookie);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
