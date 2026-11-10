/**
 * The public URL surface: who owns `{host}/<path>`.
 *
 * Sales pages moved from `/p/<slug>` to `/<slug>`, which puts them in the root
 * namespace — the same place as the app's own routes (`/login`,
 * `/salespages/<uuid>`), the static bundle (`/assets/*`) and the API proxy
 * (`/api/*`). Something has to arbitrate, and it has to arbitrate in *one*
 * place: the Pages Function that serves production and the middleware Vite
 * runs in dev must never disagree, or a page that works locally 404s after
 * deploy.
 *
 * The rules, first match wins:
 *
 *  1. `/`                      → the SPA shell (the storefront renders there)
 *  2. `/api`, `/api/*`          → the API Worker, unchanged
 *  3. a dotted last segment     → a static file (`/assets/x.js`, `/icon.png`)
 *  4. a reserved first segment  → the SPA shell (app routes and build paths)
 *  5. anything else             → the API Worker: a slug lookup that serves
 *                                 the document or the branded HTML 404
 *
 * Ordering is load-bearing. Rule 3 before rule 4 so `/assets/x.js` reaches the
 * file rather than being read as an app route; the test is exact because a
 * slug can never contain a dot (`salesPageSlugSchema`).
 *
 * Rule 5 is also what retires `/p/<slug>`: `p` is deliberately *not* reserved,
 * so old links fall through to the Worker and 404 branded instead of bouncing
 * into the app. Reserving it would send them to the SPA, which answers with a
 * redirect — not the 404 a dead link should get.
 */

/**
 * First path segments that belong to the app or the build rather than to a
 * page. Keep in step with `App.tsx`: every single-segment route the router
 * gains needs its segment here, or a page created at that address would sit
 * behind a shell that never renders it — and `salesPageSlugSchema` refuses to
 * create one while it is listed.
 */
export const RESERVED_SLUGS = [
  // SPA routes (App.tsx) — the shell must win for these.
  "sign-up",
  "login",
  "home",
  "products",
  "product", // heads /product/:uuid
  "orders",
  "order", // heads /order/:uuid
  "customers",
  "customer", // heads /customer/:uuid
  "templates",
  "salespages", // heads /salespages/:uuid
  "storefront",
  "system",
  "integrations",
  // Paths the build output and the API own at the root.
  "api",
  "assets",
  "fixtures",
] as const;

const RESERVED = new Set<string>(RESERVED_SLUGS);

/** True when `slug` cannot name a page because the app owns that address. */
export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug.toLowerCase());
}

/**
 * Which layer serves a public path:
 *
 * - `spa`   — `index.html`; the client router takes it from there
 * - `asset` — a file straight off the build output
 * - `api`   — the API Worker, unchanged (session cookie, CSRF check intact)
 * - `page`  — the API Worker: a slug lookup, or its branded HTML 404
 *
 * `pathname` may carry a query or fragment — `req.url` does — so both are cut
 * before classifying. Without that, `/login?from=home` would read as a slug and
 * forward a reserved route to the Worker.
 */
export type PublicRoute = "spa" | "asset" | "api" | "page";

export function classifyPublicPath(pathname: string): PublicRoute {
  const cut = pathname.search(/[?#]/);
  const path = cut === -1 ? pathname : pathname.slice(0, cut);
  const segments = path.split("/").filter(Boolean);

  if (segments.length === 0) return "spa"; // "/"
  if (path === "/api" || path.startsWith("/api/")) return "api";
  if (segments[segments.length - 1]?.includes(".")) return "asset";
  const first = segments[0];
  if (first !== undefined && isReservedSlug(first)) return "spa";
  return "page";
}
