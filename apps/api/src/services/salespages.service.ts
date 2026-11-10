import { providerOf } from "@storesy/shared";
import type {
  CreateSalesPageInput,
  SalesPage,
  SalesPageHtmlSlot,
  SalesPageSummary,
  UpdateSalesPageInput,
} from "@storesy/shared";
import { conflict, notFound, validationFailed } from "../core/errors";
import * as htmlFiles from "./salespage-html.service";
import * as salespagesModel from "../models/salespages.repository";
import * as integrationsRepo from "../models/integrations.repository";
import type { SalesPageData, SalesPageRow } from "../models/schema";
import { klNow } from "./time";
import { entityUuid, ID_PREFIX } from "./uuid";

/** The three editor slots a page may store a document in. */
const HTML_SLOTS: SalesPageHtmlSlot[] = ["component", "code", "ai"];

/** List-row shape: never carries documents (they live in R2). */
export function toSummary(row: SalesPageRow): SalesPageSummary {
  const data = row.data as SalesPageData;
  return {
    id: row.uuid,
    name: row.name,
    slug: row.slug,
    status: row.status === "closed" ? "closed" : "open",
    visits: data.visits ?? 0,
    htmlType: data.htmlType ?? "code",
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

/** Reads the stored documents back out of R2, keyed by editor slot. */
async function hydrateHtmlByType(
  env: Env,
  html: Partial<Record<SalesPageHtmlSlot, string>>,
): Promise<Partial<Record<SalesPageHtmlSlot, string>>> {
  const hydrated: Partial<Record<SalesPageHtmlSlot, string>> = {};
  for (const slot of HTML_SLOTS) {
    const path = html[slot];
    if (!path) continue;
    const object = await htmlFiles.getHtml(env, path);
    // A missing object (orphaned path) degrades to "no document for this
    // type" — the SPA then renders its generated source, never a broken frame.
    if (object) hydrated[slot] = await object.text();
  }
  return hydrated;
}

/** Full editor shape: everything the summary carries, plus hydrated markup. */
async function toPublic(env: Env, row: SalesPageRow): Promise<SalesPage> {
  const data = row.data as SalesPageData;
  return {
    ...toSummary(row),
    seo: data.seo ?? { title: "", description: "", keywords: "" },
    og: data.og ?? { title: "", description: "", image: "" },
    sections: data.sections ?? [],
    style: data.style ?? {},
    checkoutProducts: data.checkoutProducts ?? [],
    paymentGateway: data.paymentGateway ?? null,
    emailSender: data.emailSender ?? null,
    trackings: data.trackings ?? [],
    htmlByType: await hydrateHtmlByType(env, data.html ?? {}),
    ...(data.htmlMode !== undefined ? { htmlMode: data.htmlMode } : {}),
    ...(data.source !== undefined ? { source: data.source } : {}),
  };
}

/** The deployment's whole page list — newest first. */
export async function list(env: Env): Promise<SalesPageSummary[]> {
  const rows = await salespagesModel.listSalesPages(env);
  return rows.map(toSummary);
}

export async function get(env: Env, uuid: string): Promise<SalesPage> {
  const row = await salespagesModel.findSalesPageByUuid(env, uuid);
  if (!row) throw notFound("salespage_not_found", "No page with that id");
  return toPublic(env, row);
}

/**
 * The public `/<slug>` read, signed out. Unknown slug 404s; a closed page
 * still returns its row so the SPA can show the paused card (its own branch),
 * exactly like the pre-API behaviour.
 */
export async function getBySlug(env: Env, slug: string): Promise<SalesPage> {
  const row = await salespagesModel.findSalesPageBySlug(env, slug);
  if (!row) throw notFound("page_not_found", "No page at that address");
  return toPublic(env, row);
}

/** What `GET /<slug>` serves: the row (for visit counting) + the document. */
export interface PublicDocument {
  row: SalesPageRow;
  body: string;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );
}

/**
 * Plain shell for a page with no stored document (created before this write
 * path existed, or a save's upload failed): a crawler and a visitor still get
 * a titled, readable page instead of a 404.
 */
function fallbackDocument(row: SalesPageRow): string {
  const name = escapeHtml(row.name);
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${name}</title></head><body style="font-family:system-ui,sans-serif;` +
    "margin:0;padding:48px 24px;text-align:center;color:#14181F;background:#fff\">" +
    `<h1 style="font-size:28px;margin:0 0 8px">${name}</h1>` +
    '<p style="margin:0;color:#5B6472">This page is being set up — check back soon.</p>' +
    "</body></html>"
  );
}

/** A closed page keeps its address but stops selling — the paused card, plain. */
function closedDocument(row: SalesPageRow): string {
  const name = escapeHtml(row.name);
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${name}</title></head><body style="font-family:system-ui,sans-serif;` +
    "margin:0;padding:48px 24px;text-align:center;color:#14181F;background:#fff\">" +
    `<h1 style="font-size:28px;margin:0 0 8px">${name}</h1>` +
    '<p style="margin:0;color:#5B6472">Sales for this page are paused right now.</p>' +
    "</body></html>"
  );
}

/**
 * The bytes `GET /<slug>` serves: the stored standalone document from R2,
 * or a plain shell when nothing is stored. Closed pages get the paused shell
 * (the old SPA route's "paused card", as plain HTML). Null = no page at that
 * slug (the route answers with an HTML 404).
 */
export async function getPublicDocument(env: Env, slug: string): Promise<PublicDocument | null> {
  const row = await salespagesModel.findSalesPageBySlug(env, slug);
  if (!row) return null;
  if (row.status === "closed") return { row, body: closedDocument(row) };
  const path = (row.data as SalesPageData).pagePath;
  if (path) {
    const object = await htmlFiles.getHtml(env, path);
    // Orphaned path (object lost) degrades to the shell, never a 500.
    if (object) return { row, body: await object.text() };
  }
  return { row, body: fallbackDocument(row) };
}

function slugTaken(): never {
  throw conflict("slug_taken", "That slug is already taken");
}

/** Unique-slug backstop: the pre-check misses only on a true race. */
function isSlugUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes("sales_pages.slug");
}

export async function create(env: Env, input: CreateSalesPageInput): Promise<SalesPage> {
  const existing = await salespagesModel.findSalesPageBySlug(env, input.slug);
  if (existing) slugTaken();

  const uuid = entityUuid(ID_PREFIX.salesPage);
  // The rendered public document lands in R2 before the row exists (same
  // rule as updates: a row never points at missing bytes; a failed insert
  // only orphans one object).
  const pagePath =
    input.document !== undefined
      ? await htmlFiles.putHtml(env, uuid, "page", input.document)
      : undefined;

  const now = klNow();
  let row: SalesPageRow;
  try {
    row = await salespagesModel.insertSalesPage(env, {
      uuid,
      name: input.name,
      slug: input.slug,
      status: "open",
      data: {
        visits: 0,
        // Titles pre-fill like the pre-API store: the SEO/OG tabs start with
        // the page's own name instead of three empty boxes.
        seo: { title: input.name, description: "", keywords: "" },
        og: { title: input.name, description: "", image: "" },
        sections: [],
        style: {},
        checkoutProducts: input.products ?? [],
        paymentGateway: null,
        emailSender: null,
        trackings: [],
        htmlType: input.htmlType ?? "code",
        html: {},
        ...(pagePath !== undefined ? { pagePath } : {}),
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch (error) {
    if (isSlugUniqueViolation(error)) slugTaken();
    throw error;
  }
  return toPublic(env, row);
}

export async function update(
  env: Env,
  uuid: string,
  input: UpdateSalesPageInput,
): Promise<SalesPage> {
  const row = await salespagesModel.findSalesPageByUuid(env, uuid);
  if (!row) throw notFound("salespage_not_found", "No page with that id");
  const data = row.data as SalesPageData;

  if (input.slug !== undefined && input.slug !== row.slug) {
    const existing = await salespagesModel.findSalesPageBySlug(env, input.slug);
    if (existing) slugTaken();
  }

  // Documents: PUT before the row write (a row never points at missing
  // bytes); deletes happen after (worst case is an orphaned object).
  const htmlInput: Partial<Record<SalesPageHtmlSlot, string | null>> = input.html ?? {};
  const written: Partial<Record<SalesPageHtmlSlot, string>> = {};
  for (const slot of HTML_SLOTS) {
    const value = htmlInput[slot];
    if (typeof value === "string") {
      written[slot] = await htmlFiles.putHtml(env, row.uuid, slot, value);
    }
  }

  const previousHtml = data.html ?? {};
  const nextHtml: Partial<Record<SalesPageHtmlSlot, string>> = { ...previousHtml };
  const dropped: string[] = [];
  for (const slot of HTML_SLOTS) {
    if (!(slot in htmlInput)) continue; // untouched
    const value = htmlInput[slot];
    if (value === null) {
      const previousPath = previousHtml[slot];
      if (previousPath) dropped.push(previousPath);
      delete nextHtml[slot];
    } else {
      nextHtml[slot] = written[slot];
    }
  }

  // The rendered public document (`/<slug>`) follows the html-slot rule:
  // a string writes the file (above, before the row), null deletes it after
  // the row write, omitted leaves the stored document untouched.
  let pagePath = data.pagePath;
  if (typeof input.document === "string") {
    pagePath = await htmlFiles.putHtml(env, row.uuid, "page", input.document);
  } else if (input.document === null && data.pagePath !== undefined) {
    dropped.push(data.pagePath);
    pagePath = undefined;
  }

  let updated: SalesPageRow;
  try {
    updated = await salespagesModel.updateSalesPage(env, row.id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      data: {
        ...data,
        ...(input.seo !== undefined ? { seo: input.seo } : {}),
        ...(input.og !== undefined ? { og: input.og } : {}),
        ...(input.sections !== undefined ? { sections: input.sections } : {}),
        ...(input.style !== undefined ? { style: input.style } : {}),
        ...(input.checkoutProducts !== undefined
          ? { checkoutProducts: input.checkoutProducts }
          : {}),
        ...(input.paymentGateway !== undefined ? { paymentGateway: input.paymentGateway } : {}),
        ...(input.emailSender !== undefined ? { emailSender: input.emailSender } : {}),
        ...(input.trackings !== undefined
          ? { trackings: await validateTrackings(env, input.trackings) }
          : {}),
        ...(input.htmlType !== undefined ? { htmlType: input.htmlType } : {}),
        // Explicit nulls clear the snapshot provenance (the editor's Reset);
        // omitted keys leave it as-is. JSON drops the undefineds, so the keys
        // really leave the stored document.
        ...(input.htmlMode !== undefined
          ? input.htmlMode !== null
            ? { htmlMode: input.htmlMode }
            : { htmlMode: undefined }
          : {}),
        ...(input.source !== undefined
          ? input.source !== null
            ? { source: input.source }
            : { source: undefined }
          : {}),
        html: nextHtml,
        ...(input.document !== undefined ? { pagePath } : {}),
        // visits is deliberately absent: the counter DO owns it additively.
        updatedAt: klNow(),
      },
    });
  } catch (error) {
    if (isSlugUniqueViolation(error)) slugTaken();
    throw error;
  }

  // Delete-on-save: drop documents the row no longer references. The row is
  // already written, so a cleanup failure only leaves an orphan behind.
  if (dropped.length > 0) {
    try {
      await htmlFiles.deleteHtml(env, dropped);
    } catch (error) {
      console.error("salespage_html_delete_failed", error);
    }
  }

  return toPublic(env, updated);
}

export async function remove(env: Env, uuid: string): Promise<void> {
  const row = await salespagesModel.findSalesPageByUuid(env, uuid);
  if (!row) throw notFound("salespage_not_found", "No page with that id");

  // Row first, documents after — the same orphan-not-dangling rule as the
  // image/file cleanups (worst case leaves bytes, never a broken read path).
  await salespagesModel.deleteSalesPage(env, row.id);
  const data = row.data as SalesPageData;
  const paths = [...Object.values(data.html ?? {}), ...(data.pagePath ? [data.pagePath] : [])];
  if (paths.length > 0) {
    try {
      await htmlFiles.deleteHtml(env, paths);
    } catch (error) {
      console.error("salespage_html_delete_failed", error);
    }
  }
}

/**
 * Trackings: uuids that still exist (a deleted row is pruned silently — the
 * data is already gone, and pruning keeps autosave from sticking on a
 * dangling pointer) and never two rows of the SAME brand: a page may carry
 * several trackings, one per brand.
 */
async function validateTrackings(env: Env, requested: string[]): Promise<string[]> {
  const rows = await integrationsRepo.listIntegrations(env);
  const byUuid = new Map(rows.map((row) => [row.uuid, row]));
  const seenProviders = new Map<string, string>(); // provider → label
  const kept: string[] = [];
  for (const uuid of requested) {
    const row = byUuid.get(uuid);
    if (!row) continue; // dangling → prune (row deleted since it was added)
    const label = providerOf(row.provider)?.label ?? row.provider;
    const clash = seenProviders.get(row.provider);
    if (clash !== undefined) {
      throw validationFailed("Check the highlighted fields", {
        trackings: `Each tracking must be a different brand — ${clash} is already on this page.`,
      });
    }
    seenProviders.set(row.provider, label);
    kept.push(uuid);
  }
  return kept;
}
