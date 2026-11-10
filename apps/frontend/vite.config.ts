import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ProxyOptions } from "vite";
import { classifyPublicPath } from "../../packages/shared/src/routing";

/** The API Worker in dev — the SPA and this proxy both talk to it directly. */
const API_TARGET = "http://127.0.0.1:8787";

/**
 * Page paths arrive at the Worker under a marker prefix and get it stripped
 * again by the proxy rule below. A real slug can never start with it: the slug
 * regex is `^[a-z0-9]+(?:-[a-z0-9]+)*$`, which allows no underscores.
 */
const PAGE_MARKER = "/__page";

/**
 * Public sales pages live at `/{slug}` — one arbitrary path segment that no
 * static proxy rule can name. This middleware resolves each request with the
 * same rules production uses (`classifyPublicPath`) and rewrites a *page* path
 * to the marker the proxy owns. Everything else falls through to Vite, which
 * serves static files and the SPA shell just as the Pages asset layer does —
 * `/api` included, proxied by its own rule below.
 *
 * Vite's own dev endpoints are exempted first: `/@vite/client`,
 * `/@react-refresh`, `/__vite_ping` and friends have no dot and aren't
 * reserved, so the classifier — correctly, for production, which has no such
 * paths — would read one as a page and hand Vite's own machinery a 404. A slug
 * can never start with `@` or `__` (the regex is `^[a-z0-9]+(?:-[a-z0-9]+)*$`),
 * so the exemption cannot shadow a real page.
 *
 * Registered in both server hooks so `vite preview` routes pages the same way
 * `vite dev` does; the shared proxy object below backs each.
 */
function publicPages(): Plugin {
  const middleware = (req: { url?: string }, _res: unknown, next: () => void): void => {
    const url = req.url ?? "/";
    if (url.startsWith("/@") || url.startsWith("/__")) return next(); // Vite's own
    if (classifyPublicPath(url) !== "page") return next();
    req.url = `${PAGE_MARKER}${url}`;
    next();
  };
  return {
    name: "storesy:public-pages",
    configureServer: (server) => {
      server.middlewares.use(middleware);
    },
    configurePreviewServer: (server) => {
      server.middlewares.use(middleware);
    },
  };
}

const proxy: Record<string, ProxyOptions> = {
  "/api": { target: API_TARGET, changeOrigin: false },
  [PAGE_MARKER]: {
    target: API_TARGET,
    changeOrigin: false,
    // Strip the marker so the Worker sees the page's real path (`/some-slug`).
    // A prefix slice keeps the query string intact either way.
    rewrite: (path) => path.slice(PAGE_MARKER.length),
  },
};

export default defineConfig({
  plugins: [react(), publicPages()],
  server: {
    port: 5173,
    // Always http://localhost:5173 — never let Vite drift to 5174+ when the
    // port is held (fails loudly instead, so a stale dev server gets killed).
    strictPort: true,
    // Local dev: the SPA talks to the Worker through the proxy, so cookies are
    // same-origin and the Vite origin matches WEB_ORIGIN. Page paths are
    // proxied too (see `publicPages()`), so dev mirrors production, where both
    // are served by the root Pages Function.
    proxy,
  },
  preview: { proxy },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  optimizeDeps: {
    exclude: ["@storesy/shared", "@storesy/ui"],
  },
});
