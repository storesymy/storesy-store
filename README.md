# Storesy Store

E-commerce platform on Cloudflare: custom-built MVC Worker API + React SPA, TypeScript end to end.

**Baseline (this milestone):** `/` (public storefront — a static document frozen on Publish), `/sign-up`, `/login`, `/home`, `/storefront`, `/p/{slug}` (public sales page — plain server-hosted HTML).

## Stack

| Layer | Choice |
| --- | --- |
| API | Cloudflare Worker, own-built MVC (Router → Context → Controller → Service → Model) |
| SPA | React 19 + Vite + React Router on **Cloudflare Pages** (`apps/frontend`) |
| Database | **D1** (SQLite) + **Drizzle ORM**, SQL migrations in `apps/api/db/migrations` |
| Sessions | **Durable Objects** (`SessionDO`), token stored hashed, HttpOnly cookie, **2h sliding window** (idle timeout) |
| Rate limits | **Durable Objects** (`RateLimitDO`), fixed windows per IP / per email |
| Config/flags | **KV** (binding present, used from phase 2) |
| Media/queues | **R2 + Queues** — reserved for phase 2 (not bound yet) |
| Contracts | `packages/shared` zod schemas used by both API and forms |
| UI kit | `packages/ui` reusable React components |

## Layout

```
apps/api        Cloudflare Worker (own MVC) + Drizzle schema + migrations + DOs
apps/frontend   Vite React SPA (Pages)
packages/shared zod schemas + API types + route table
packages/ui     reusable components (Button, TextField, Card, Shell, Alert)
.github         ci.yml (checks + multi-account production deploy)
```

## Local development

```bash
npm install
npm run db:migrate:local   # apply migrations to local D1
npm run dev                # wrangler dev (8787) + vite (5173), proxied
```

Open http://localhost:5173/sign-up — the SPA proxies `/api` (and `/p`, the public
sales-page documents) to the Worker, so cookies are same-origin.

| Script | What it does |
| --- | --- |
| `npm run dev` | API + frontend dev servers |
| `npm run typecheck` | TypeScript across all workspaces |
| `npm test` | Uptime tests only (see policy below) |
| `npm run build` | Production SPA build to `apps/frontend/dist` |
| `npm run db:generate` | Generate a new migration from Drizzle schema changes |
| `npm run db:migrate:local` / `db:migrate:remote` | Apply migrations to a locally configured D1 (CI uses the generated account config) |
| `npm run bootstrap:account -- smbiz` | Create/reuse one account's Cloudflare resources and print its GitHub Environment values |

## API surface

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | Uptime canary, no session/DB |
| POST | `/api/auth/signup` | Rate limited5/h per IP → `201` + cookie |
| POST | `/api/auth/login` | Rate limited10/15min per email → `200` + cookie, `429` + `Retry-After` |
| POST | `/api/auth/logout` | Revokes session → `204` |
| GET | `/api/me` | Current user → `200` / `401` |
| POST | `/api/public/orders` | Place an order from a sales page's checkout — signed out, rate-limited, prices revalidated server-side → `201` / `404` / `409` / `422` / `429` |
| GET | `/api/orders` | Merchant's orders, newest first (`?page=spg_…` narrows to one page) |
| GET | `/api/integrations` | Integration instances — **admin-only** (`401`/`403`); reads carry masked hints (`••••1234`), never a secret |
| POST | `/api/integrations` | Create = connect: provider + name + fields validated against the shared catalogue; secrets AES-GCM encrypted at rest → `201` / `422` |
| PATCH | `/api/integrations/:uuid` | Rename / rotate credentials / update config — omitted keys stay unchanged (blank secrets are refused) → `200` / `404` / `422` |
| DELETE | `/api/integrations/:uuid` | Hard-delete an instance → `204` / `404` |
| GET | `/:slug` | Public sales page — the stored HTML document, signed out, counts visits |
| GET | `/*` | Anything else — branded HTML `404` (retired `/p/<slug>` links, typo'd paths); JSON under `/api/` |

Errors always return `{ "error": { "code", "message", "fields"? } }`.

## Public sales pages (`/<slug>`)

The page a customer lands on is a plain HTML document — a crawler reads the
title, OG tags and every section without running a byte of JavaScript. The
SPA builds it on every save (`lib/salesPageDocument.ts`: SEO/OG `<head>`,
Google Fonts, section styles inlined, sections rendered with FAQ answers open
and carousel slides stacked) and sends it as `document`; the Worker stores it
in R2 (`salespages/<spg-uuid>/page.html`, path only in D1) and streams it at
`GET /:slug` — `no-store`, visits counted through the counter DO. A
complete imported document ships untouched; a page with no stored document,
or a closed one, serves a plain titled shell.

The address sits at the **root**, next to the app's own routes, the static
bundle and `/api`, so one classifier arbitrates:
`packages/shared/src/routing.ts` decides whether a path belongs to the API,
the build, the SPA shell or a page — and the Pages Function
(`apps/frontend/functions/[[slug]].ts`), the dev middleware
(`vite.config.ts`) and the slug schema all read that same list, so a page can
never shadow `/login` and never works locally but 404s after deploy.
Forwarding `/api/*` through that function also means the whole API is
proxied, not just the two endpoints a Pages Function used to cover. Reserved
slugs are refused at creation. `public/_routes.json` keeps `/assets/*` out of
the function, so bundle requests stay on the static tier instead of each one
invoking it.

The old `/p/<slug>` shape is retired: those links fall through to `GET /*`
and get the branded `404` document rather than a redirect.

## Checkout on the public page

When a page's Checkout tab is set to "Show Checkout" and has products picked,
the stored document carries a checkout block: real markup (product cards with
prices, cart, customer form — readable and crawlable with scripts off) plus
one small inline script that adds the cart behaviour. The script keeps the
cart in `localStorage` per page and submits to `POST /api/public/orders`
(same-origin; production forwards it through
`apps/frontend/functions/api/public/[[path]].ts`, and product images through
`…/api/images/[[path]].ts`). The API never trusts the page's prices: it
recomputes every line from its own rows and answers `409 price_changed` when
the document's baked total no longer matches (the script then reloads the
page). Orders land as `pending` rows; the merchant reads them at
`GET /api/orders` (sidebar → Orders). Imported/complete documents ship
untouched — no checkout is injected into them.

## Repo policies

**Tests — uptime and money only.**
Tests are written only for (1) things that break the system if they fail, and
(2) logic that affects money/profit. Nothing else gets a test unless explicitly
requested. Today that is `apps/api/test/auth.smoke.test.ts` (the full request
path: router → middleware → D1 → DOs → cookie). No coverage targets.

**Migrations — non-destructive.**
Applied SQL migrations are immutable: never edit or delete a file in
`apps/api/db/migrations`. Change the Drizzle schema, run `npm run db:generate`,
and commit the new file. CI fails any PR that modifies an existing migration.
Durable Object classes in `wrangler.jsonc` are append-only (`migrations` block:
add only). New Durable Objects on the Workers Free plan must be created with
`new_sqlite_classes`. Deploys are forward-only; app code tolerates old + new
schema.

**Deploy — every push to `main`.**
`.github/workflows/ci.yml` is the single pipeline: PRs and pushes run
typecheck → tests → build (plus the migration-immutability guard on PRs). On a
push to `main` (or a manual dispatch from `main`), the same build artifact is
deployed to every account in the matrix:

```
checks ──► deploy matrix ──┬── smbiz
                           ├── kakbelle   (add when ready)
                           └── kdh        (add when ready)
```

Accounts are fully isolated Cloudflare stacks. The matrix currently contains
only `smbiz`; add the other two lines after their GitHub Environment and
resources exist. Deployments are serialized across pushes
(`cancel-in-progress: false`); the accounts in the matrix deploy in parallel.

Within each account the order is fixed:

1. apply D1 migrations (`--remote`),
2. deploy the API Worker,
3. set the Worker secrets,
4. point Pages at the Worker (`API_ORIGIN`),
5. deploy the SPA to Pages,
6. health-check `<pages-url>/api/health`.

## Cloudflare accounts

| | smbiz | kakbelle | kdh |
| --- | --- | --- | --- |
| GitHub Environment | `smbiz` | `kakbelle` | `kdh` |
| Worker | `storesy-api` | `storesy-api` | `storesy-api` |
| D1 | `storesy` | `storesy` | `storesy` |
| KV | `storesy-kv` | `storesy-kv` | `storesy-kv` |
| R2 | `storesy-images` | `storesy-images` | `storesy-images` |
| Pages project | `smbiz` | `kakbelle` | `kdh` |
| SPA URL | `https://smbiz.pages.dev` | `https://kakbelle.pages.dev` | `https://kdh.pages.dev` |

Worker, D1, KV and R2 names are account-scoped, so they can stay the same in
every account. Pages project names become public `*.pages.dev` hostnames, so
each account uses its project label.

## Turning on smbiz — UI walkthrough

### 1. Create the Cloudflare API token (Cloudflare dashboard)

1. Open the Cloudflare dashboard while signed in to the **smbiz** account.
2. Go to **Manage Account → Account API Tokens → Create Token**.
   On older accounts this lives under **My Profile → API Tokens**.
3. Choose **Create Custom Token** and grant:
   - Account → Workers Scripts → Edit
   - Account → Workers KV Storage → Edit
   - Account → D1 → Edit
   - Account → Workers R2 Storage → Edit
   - Account → Cloudflare Pages → Edit
   - Account → Account Settings → Read
4. Create the token and copy it once. Cloudflare will not show it again.

Copy the **Account ID** too: open **Workers & Pages** and read it from the right
sidebar, or copy the ID from the dashboard URL
(`dash.cloudflare.com/<account-id>/...`).

> **There is no repository file for the Cloudflare token.** Never put it in
> `wrangler.jsonc`, `.dev.vars`, or any committed file. It goes into a GitHub
> Environment secret in step 5.

### 2. Bootstrap the account (one terminal command)

From the repository root:

```bash
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
  npm run bootstrap:account -- smbiz
```

The script creates or reuses the account's D1 database, KV namespace, R2 bucket
and Pages project. It prints the values you will paste into GitHub in steps 4
and 5, including:

```text
CLOUDFLARE_ACCOUNT_ID
WORKER_NAME
D1_DATABASE_ID
KV_NAMESPACE_ID
R2_BUCKET_NAME
PAGES_PROJECT_NAME
WORKERS_SUBDOMAIN
WEB_ORIGIN
```

If your account token can use Workers but cannot read the `/workers/subdomain`
endpoint, pass the known value directly:

```bash
WORKERS_SUBDOMAIN=nbrobot \
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
  npm run bootstrap:account -- smbiz
```

### 3. Create the GitHub Environment (GitHub UI)

1. Open the repository on GitHub.
2. Click **Settings** in the repository's top navigation.
3. In the left sidebar click **Environments**.
4. Click **New environment**.
5. Name it exactly **`smbiz`** and click **Configure environment**.

If `smbiz` already exists, just click it.

### 4. Add the Environment variables (GitHub UI)

Still on **Settings → Environments → smbiz**:

1. Find **Environment variables**.
2. Click **Add variable**.
3. Enter the name and value from the bootstrap output.
4. Click **Add variable** again for each row below.

| Name | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | the smbiz account ID |
| `WORKER_NAME` | `storesy-api` |
| `D1_DATABASE_ID` | from the bootstrap output |
| `KV_NAMESPACE_ID` | from the bootstrap output |
| `R2_BUCKET_NAME` | `storesy-images` |
| `PAGES_PROJECT_NAME` | `smbiz` |
| `WORKERS_SUBDOMAIN` | from the bootstrap output, without `.workers.dev` |
| `WEB_ORIGIN` | `https://smbiz.pages.dev` (or the exact value printed) |

To change one later: **Settings → Environments → smbiz → Environment variables
→ the variable's pencil/Update button**.

### 5. Add the Environment secrets (GitHub UI)

Still on **Settings → Environments → smbiz**:

1. Find **Environment secrets**.
2. Click **Add secret**.
3. Name it `CLOUDFLARE_API_TOKEN`, paste the token from step 1, click **Add secret**.
4. Click **Add secret** again for `INTEGRATIONS_KEY`.

`INTEGRATIONS_KEY` must be a random 32-byte base64 value, unique per account.
Generate one locally, for example:

```bash
openssl rand -base64 32
```

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | the token copied from the Cloudflare dashboard |
| `INTEGRATIONS_KEY` | a fresh `openssl rand -base64 32` value |

GitHub never shows a secret value again. To replace one, use the **Update**
button next to it. Changing a secret is a replacement, not an edit.

> Use **Environment secrets**, not **Settings → Secrets and variables → Actions →
> Repository secrets**. The deploy job selects `environment: smbiz`, and only
> environment-scoped values are visible to it.

### 6. Run the first deployment (GitHub UI)

1. Open the repository's **Actions** tab.
2. Select **CI & Deploy** in the left sidebar.
3. Click **Run workflow**.
4. Choose branch **main** and click **Run workflow**.

The run executes checks, then deploys **smbiz** only. After it succeeds, every
push to `main` deploys smbiz automatically.

### Adding kakbelle and kdh later

Repeat steps 1–6 with the matching label, then uncomment the account in
`.github/workflows/ci.yml`:

```yaml
matrix:
  environment:
    - smbiz
    - kakbelle
    - kdh
```

### GitHub Environment contents

Variables:

```text
CLOUDFLARE_ACCOUNT_ID
WORKER_NAME          # storesy-api
D1_DATABASE_ID
KV_NAMESPACE_ID
R2_BUCKET_NAME       # storesy-images
PAGES_PROJECT_NAME   # smbiz / kakbelle / kdh
WORKERS_SUBDOMAIN    # just the subdomain, e.g. "smbiz" (before .workers.dev)
WEB_ORIGIN           # https://<pages-subdomain> (bootstrap prints the exact value)
```

Secrets:

```text
CLOUDFLARE_API_TOKEN
INTEGRATIONS_KEY     # unique per account
```

Optional:

```text
INTEGRATIONS_KEY_PREV   # only while rotating the key
API_ORIGIN              # optional override; normally derived from the Worker + subdomain
PAGES_BRANCH            # default: main
```

The deploy workflow renders `apps/api/wrangler.deploy.jsonc` from the committed
`apps/api/wrangler.jsonc`, injecting the account's IDs and origins. The generated
file is gitignored and contains no secrets. `API_ORIGIN` is then set on the Pages
project by CI, so the Pages dashboard needs no manual environment variables.

The SPA origin allowlist is the CSRF defence: the API rejects state-changing
requests whose `Origin` is not in `WEB_ORIGIN`. The bootstrap prints the exact
Pages URL; it may be a comma-separated list if both a custom domain and
`*.pages.dev` are used.

### Rotation and rollback

- **Key rotation:** set `INTEGRATIONS_KEY_PREV` to the old key, rotate
  `INTEGRATIONS_KEY`, deploy, then remove `INTEGRATIONS_KEY_PREV`. The next
  deploy also deletes it from the Worker.
- **Code rollback:** revert the commit and push; all configured accounts deploy
  the reverted code. Worker versions and Pages deployments can also be rolled
  back in the dashboard.
- **Migrations are forward-only.** D1 captures a backup before applying; use
  Time Travel if a data restore is ever needed. Never edit an applied migration.

## Phase 2 (not in baseline)

Stores / orders / products / inventory / fulfilment CRUD, email verification &
password reset (Queues + provider), email templates, payment gateway
integrations, R2 media, OAuth login — money-touching logic gets tests.
