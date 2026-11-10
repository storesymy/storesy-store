/**
 * `GET /*` — the whole public URL surface in one root function.
 *
 * Sales pages live at `/{slug}`, which shares the root namespace with the
 * app's own routes, the static bundle and the API. The rules that arbitrate
 * between them live in `@storesy/shared`'s routing module so that this
 * function, the dev middleware in `vite.config.ts` and the slug schema all
 * read from one list — a page that works locally and 404s after deploy is the
 * failure this exists to prevent.
 *
 * Two things only this layer can do: serve the SPA shell (there is no file at
 * `/login`, so the client router must receive `index.html`) and reach the
 * static bundle through `env.ASSETS`, which Pages provides automatically.
 *
 * Everything under `/api` and every slug path is passed to the API Worker
 * *verbatim* — method, body and headers intact. That matters for three
 * headers in particular: `Cookie` (the session), `Origin` (the Worker's CSRF
 * check) and the response's `Set-Cookie` (`__Host-storesy_sid`, whose prefix
 * the browser rejects the cookie over if a `Domain` ever creeps in). The
 * response is returned as-is rather than re-wrapped, so `Cache-Control:
 * no-store` on a document and any `Set-Cookie` on an API write both survive.
 *
 * Configuration: one plain-text variable on the Pages project — `API_ORIGIN`,
 * the deployed Worker's address (e.g. `https://storesy-api.<account>.workers.dev`).
 */
import { classifyPublicPath } from "../../../packages/shared/src/routing";

interface Env {
  API_ORIGIN: string;
  /** Pages' automatic binding to the project's own static files. */
  ASSETS: { fetch(input: Request | URL): Promise<Response> };
}

interface EventContext {
  env: Env;
  request: Request;
}

/**
 * Hand the request to the API Worker and give back whatever it says.
 *
 * The upstream response is passed through untouched: re-wrapping it to pick
 * headers would drop `Set-Cookie` (breaking login) and risk a body whose
 * `Content-Encoding` no longer matches its bytes.
 */
async function forward(env: Env, request: Request): Promise<Response> {
  if (!env.API_ORIGIN) {
    return new Response("API_ORIGIN is not configured on this Pages project", { status: 500 });
  }
  const incoming = new URL(request.url);
  const target = new URL(env.API_ORIGIN);
  target.pathname = incoming.pathname; // the path passes through unchanged
  target.search = incoming.search;

  const headers = new Headers(request.headers);
  headers.delete("Host"); // the Worker's address, not the browser's

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const init: RequestInit = { method: request.method, headers, redirect: "follow" };
  // Buffered rather than streamed: every write this app makes is a small
  // JSON/multipart body, and a buffer sidesteps the duplex requirements a
  // streamed body carries.
  if (hasBody) init.body = await request.arrayBuffer();

  return fetch(target.toString(), init);
}

export async function onRequest(context: EventContext): Promise<Response> {
  const { env, request } = context;
  const url = new URL(request.url);
  const route = classifyPublicPath(url.pathname);

  if (route === "asset") return env.ASSETS.fetch(request);

  // The SPA shell for `/` and for every reserved segment (`/login`,
  // `/salespages/<uuid>`, `/product/<uuid>`): request the asset's pretty path
  // so Pages serves `index.html` without a redirect hop.
  if (route === "spa") return env.ASSETS.fetch(new Request(new URL("/", url)));

  return forward(env, request); // "api" and "page" both belong to the Worker
}
