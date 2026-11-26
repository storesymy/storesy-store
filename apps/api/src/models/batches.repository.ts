import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { BatchRow, NewBatchRow } from "./schema";
import { batches } from "./schema";

function db(env: Env) {
  return drizzle(env.DB);
}

/** Batches, newest first (rowid order = creation order). */
export async function listBatches(env: Env): Promise<BatchRow[]> {
  return db(env).select().from(batches).orderBy(desc(batches.id)).all();
}

export async function findBatchByUuid(env: Env, uuid: string): Promise<BatchRow | null> {
  const rows = await db(env).select().from(batches).where(eq(batches.uuid, uuid)).limit(1).all();
  return rows[0] ?? null;
}

export async function insertBatch(env: Env, values: NewBatchRow): Promise<BatchRow> {
  const inserted = await db(env).insert(batches).values(values).returning().all();
  const created = inserted[0];
  if (!created) throw new Error("Batch insert returned no row");
  return created;
}
