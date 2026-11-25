import { and, desc, eq, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { NewShippingZoneRow, ShippingZoneData, ShippingZoneRow } from "./schema";
import { shippingZones } from "./schema";

function db(env: Env) {
  return drizzle(env.DB);
}

/**
 * All rates, newest first. Like products, rows are not account-scoped: one
 * install serves one store.
 */
export async function listShippingZones(env: Env): Promise<ShippingZoneRow[]> {
  return db(env).select().from(shippingZones).orderBy(desc(shippingZones.id)).all();
}

export async function findShippingZoneByUuid(
  env: Env,
  uuid: string,
): Promise<ShippingZoneRow | null> {
  const rows = await db(env)
    .select()
    .from(shippingZones)
    .where(eq(shippingZones.uuid, uuid))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

/** The routing key — one row may own each zone + courier pair. */
export async function findShippingZoneByRoute(
  env: Env,
  zoneKey: string,
  courierKey: string,
  exceptId?: number,
): Promise<ShippingZoneRow | null> {
  const where =
    exceptId === undefined
      ? and(eq(shippingZones.zoneKey, zoneKey), eq(shippingZones.courierKey, courierKey))
      : and(
          eq(shippingZones.zoneKey, zoneKey),
          eq(shippingZones.courierKey, courierKey),
          ne(shippingZones.id, exceptId),
        );
  const rows = await db(env).select().from(shippingZones).where(where).limit(1).all();
  return rows[0] ?? null;
}

export async function insertShippingZone(
  env: Env,
  values: NewShippingZoneRow,
): Promise<ShippingZoneRow> {
  const inserted = await db(env).insert(shippingZones).values(values).returning().all();
  const created = inserted[0];
  if (!created) throw new Error("Shipping zone insert returned no row");
  return created;
}

export async function updateShippingZone(
  env: Env,
  id: number,
  changes: { zoneKey: string; courierKey: string; status: string; data: ShippingZoneData },
): Promise<ShippingZoneRow> {
  const updated = await db(env)
    .update(shippingZones)
    .set(changes)
    .where(eq(shippingZones.id, id))
    .returning()
    .all();
  const row = updated[0];
  if (!row) throw new Error("Shipping zone update returned no row");
  return row;
}

export async function deleteShippingZone(env: Env, id: number): Promise<void> {
  await db(env).delete(shippingZones).where(eq(shippingZones.id, id)).all();
}
