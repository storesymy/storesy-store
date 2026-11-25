import { ORDER_SHIPPING_CENTS } from "@storesy/shared";
import type {
  PublicShippingRates,
  ShippingCourierKey,
  ShippingZone,
  ShippingZoneInput,
  ShippingZoneStatus,
} from "@storesy/shared";
import { conflict, notFound, validationFailed } from "../core/errors";
import type { ShippingZoneRow } from "../models/schema";
import * as repo from "../models/shippingZones.repository";
import { klNow } from "./time";
import { entityUuid, ID_PREFIX } from "./uuid";

function toDto(row: ShippingZoneRow): ShippingZone {
  return {
    id: row.uuid,
    zoneKey: row.zoneKey,
    courierKey: row.courierKey as ShippingCourierKey,
    priceType: row.data.priceType,
    priceCents: row.data.priceCents,
    status: row.status as ShippingZoneStatus,
    createdAt: row.data.createdAt,
    updatedAt: row.data.updatedAt,
  };
}

/**
 * Follow API has no amount; flat and markup must carry one. The shared schema
 * already enforces this, but the service repeats it so direct callers cannot
 * write a row the database CHECK would reject as a 500.
 */
function priceCentsFor(input: ShippingZoneInput): number | null {
  if (input.priceType === "api") return null;
  if (input.priceCents == null) {
    throw validationFailed("Check the highlighted fields", {
      priceCents: "Enter an amount for this price type",
    });
  }
  return input.priceCents;
}

/**
 * The signed-out rate card the checkout script reads. Keys and amounts only —
 * no merchant labels or account data. An empty card means the store has not
 * configured zones yet, and the legacy flat rate still applies.
 */
export async function publicRates(env: Env): Promise<PublicShippingRates> {
  const rows = await repo.listActiveShippingZones(env);
  return {
    rates: rows.map((row) => ({
      zoneKey: row.zoneKey,
      courierKey: row.courierKey as ShippingCourierKey,
      priceType: row.data.priceType,
      priceCents: row.data.priceCents,
    })),
    fallbackCents: ORDER_SHIPPING_CENTS,
  };
}

export async function list(env: Env): Promise<ShippingZone[]> {
  const rows = await repo.listShippingZones(env);
  return rows.map(toDto);
}

export async function get(env: Env, uuid: string): Promise<ShippingZone> {
  const row = await repo.findShippingZoneByUuid(env, uuid);
  if (!row) throw notFound("shipping_zone_not_found", "No shipping zone with that id");
  return toDto(row);
}

export async function create(env: Env, input: ShippingZoneInput): Promise<ShippingZone> {
  const existing = await repo.findShippingZoneByRoute(env, input.zoneKey, input.courierKey);
  if (existing) {
    throw conflict(
      "shipping_zone_exists",
      "That zone and courier already has a rate. Edit the existing row instead.",
    );
  }

  const now = klNow();
  const row = await repo.insertShippingZone(env, {
    uuid: entityUuid(ID_PREFIX.shippingZone),
    zoneKey: input.zoneKey,
    courierKey: input.courierKey,
    status: input.status ?? "active",
    data: {
      priceType: input.priceType,
      priceCents: priceCentsFor(input),
      createdAt: now,
      updatedAt: now,
    },
  });
  return toDto(row);
}

export async function update(
  env: Env,
  uuid: string,
  input: ShippingZoneInput,
): Promise<ShippingZone> {
  const row = await repo.findShippingZoneByUuid(env, uuid);
  if (!row) throw notFound("shipping_zone_not_found", "No shipping zone with that id");

  const duplicate = await repo.findShippingZoneByRoute(
    env,
    input.zoneKey,
    input.courierKey,
    row.id,
  );
  if (duplicate) {
    throw conflict(
      "shipping_zone_exists",
      "That zone and courier already has a rate. Edit the existing row instead.",
    );
  }

  const updated = await repo.updateShippingZone(env, row.id, {
    zoneKey: input.zoneKey,
    courierKey: input.courierKey,
    status: input.status ?? row.status,
    data: {
      priceType: input.priceType,
      priceCents: priceCentsFor(input),
      createdAt: row.data.createdAt,
      updatedAt: klNow(),
    },
  });
  return toDto(updated);
}

export async function remove(env: Env, uuid: string): Promise<void> {
  const row = await repo.findShippingZoneByUuid(env, uuid);
  if (!row) throw notFound("shipping_zone_not_found", "No shipping zone with that id");
  await repo.deleteShippingZone(env, row.id);
}

