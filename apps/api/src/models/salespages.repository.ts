import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { NewSalesPageRow, SalesPageData, SalesPageRow } from "./schema";
import { salesPages } from "./schema";

function db(env: Env) {
  return drizzle(env.DB);
}

/**
 * All sales pages, newest first (rowid order = creation order). Like
 * products, rows are not account-scoped: one install serves one catalogue.
 */
export async function listSalesPages(env: Env): Promise<SalesPageRow[]> {
  return db(env).select().from(salesPages).orderBy(desc(salesPages.id)).all();
}

/** Lookup by the public `spg-…` uuid (parameterized — safe for any input). */
export async function findSalesPageByUuid(env: Env, uuid: string): Promise<SalesPageRow | null> {
  const rows = await db(env)
    .select()
    .from(salesPages)
    .where(eq(salesPages.uuid, uuid))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

/** Lookup by the public URL slug — the `/<slug>` read path. */
export async function findSalesPageBySlug(env: Env, slug: string): Promise<SalesPageRow | null> {
  const rows = await db(env)
    .select()
    .from(salesPages)
    .where(eq(salesPages.slug, slug))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

export async function insertSalesPage(env: Env, values: NewSalesPageRow): Promise<SalesPageRow> {
  const inserted = await db(env).insert(salesPages).values(values).returning().all();
  const created = inserted[0];
  if (!created) throw new Error("Sales page insert returned no row");
  return created;
}

/** Partial update by rowid: optional column changes + the rebuilt data JSON. */
export async function updateSalesPage(
  env: Env,
  id: number,
  changes: { name?: string; slug?: string; status?: string; data: SalesPageData },
): Promise<SalesPageRow> {
  const updated = await db(env)
    .update(salesPages)
    .set({
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.slug !== undefined ? { slug: changes.slug } : {}),
      ...(changes.status !== undefined ? { status: changes.status } : {}),
      data: changes.data,
    })
    .where(eq(salesPages.id, id))
    .returning()
    .all();
  const row = updated[0];
  if (!row) throw new Error("Sales page update returned no row");
  return row;
}

export async function deleteSalesPage(env: Env, id: number): Promise<void> {
  await db(env).delete(salesPages).where(eq(salesPages.id, id));
}

/**
 * Additive visit bump — one atomic statement, so a page save (which rewrites
 * `data` wholesale from the row it just read) can never clobber pending
 * counts: this runs either fully before or fully after the save's own
 * read-modify-write, and always lands on the freshest value.
 */
export async function incrementVisits(env: Env, uuid: string, by: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE sales_pages
     SET data = json_set(
       data,
       '$.visits',
       COALESCE(json_extract(data, '$.visits'), 0) + ?
     )
     WHERE uuid = ?`,
  )
    .bind(by, uuid)
    .run();
}
