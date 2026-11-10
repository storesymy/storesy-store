import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { NewProductRow, ProductData, ProductRow } from "./schema";
import { products } from "./schema";

function db(env: Env) {
  return drizzle(env.DB);
}

/**
 * All products, newest first (rowid order = creation order). Products are NOT
 * account-scoped: this code is installed per client infra, so one deployment
 * serves one catalog — accounts gate access to the app, not rows.
 */
export async function listProducts(env: Env): Promise<ProductRow[]> {
  return db(env).select().from(products).orderBy(desc(products.id)).all();
}

/** Lookup by the public `prd-…` uuid (parameterized — safe for any input). */
export async function findProductByUuid(env: Env, uuid: string): Promise<ProductRow | null> {
  const rows = await db(env)
    .select()
    .from(products)
    .where(eq(products.uuid, uuid))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

export async function insertProduct(env: Env, values: NewProductRow): Promise<ProductRow> {
  const inserted = await db(env).insert(products).values(values).returning().all();
  const created = inserted[0];
  if (!created) throw new Error("Product insert returned no row");
  return created;
}

/** Partial update by rowid: optional rename + the rebuilt data JSON. */
export async function updateProduct(
  env: Env,
  id: number,
  changes: { name?: string; data: ProductData },
): Promise<ProductRow> {
  const updated = await db(env)
    .update(products)
    .set({
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      data: changes.data,
    })
    .where(eq(products.id, id))
    .returning()
    .all();
  const row = updated[0];
  if (!row) throw new Error("Product update returned no row");
  return row;
}
