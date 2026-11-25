import {
  ORDER_SHIPPING_CENTS,
  SHIPPING_COURIERS,
  shippingZoneCandidates,
} from "@storesy/shared";
import type {
  ShippingCourierKey,
  ShippingQuote,
  ShippingQuoteReason,
  ShippingPriceType,
} from "@storesy/shared";
import type { OrderShippingData, ProductRow, ShippingZoneRow } from "../models/schema";
import * as shippingZonesModel from "../models/shippingZones.repository";
import * as myParcel from "./myParcel.service";
import type { MpaQuoteResult, MpaRate } from "./myParcel.service";
import { klNow } from "./time";

/**
 * The one place a cart's delivery price is decided. Flat rows are stored
 * amounts; `api`/`markup` rows ask MyParcel Asia for a live domestic quote.
 * The public quote endpoint and order creation both call this, so the cart
 * price and the charge can never drift.
 */

export interface QuoteLine {
  row: ProductRow;
  qty: number;
}

export interface QuoteDestination {
  country: string;
  state?: string;
  postcode?: string;
}

export type MpaQuoteFn = (
  env: Env,
  input: { receiverPostcode: string; weightKg: number },
) => Promise<MpaQuoteResult>;

export interface QuoteDeps {
  /** Test seam: replace the live MPA call with a fixture. */
  mpaQuote?: MpaQuoteFn;
}

export interface ParcelDimensions {
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
}

export type ParcelResult =
  | { ok: true; weightKg: number; dimensions: ParcelDimensions }
  | { ok: false; reason: "weight_missing" | "too_heavy" };

const MPA_MAX_KG = 30;
const VOLUMETRIC_DIVISOR = 5000;
const COURIER_RANK = new Map<string, number>(
  SHIPPING_COURIERS.map((courier, index) => [courier.key, index]),
);

const MESSAGES: Record<ShippingQuoteReason, string> = {
  destination_incomplete: "Enter your 5-digit postcode to see shipping.",
  no_rate: "We don't have a shipping rate for this address yet.",
  provider_unavailable: "Shipping is temporarily unavailable — please try again.",
  weight_missing: "Shipping isn't available for this item yet — contact the store.",
  too_heavy: "This order is too heavy for courier delivery — contact the store.",
};

function unavailable(reason: ShippingQuoteReason): ShippingQuote {
  return {
    available: false,
    source: null,
    shippingCents: 0,
    zoneKey: null,
    courierKey: null,
    priceType: null,
    provider: null,
    reason,
    message: MESSAGES[reason],
  };
}

/**
 * Chargeable weight: per unit, the greater of actual and volumetric weight
 * (L×W×H/5000), summed across units. Missing weight AND dimensions blocks the
 * quote rather than guessing a price.
 */
export function computeParcel(lines: QuoteLine[]): ParcelResult {
  let weightKg = 0;
  let shippingUnits = 0;
  let lengthCm: number | null = null;
  let widthCm: number | null = null;
  let heightCm: number | null = null;

  for (const line of lines) {
    const data = line.row.data;
    if ((data.fulfilment ?? { shipment: true }).shipment !== true) continue;
    shippingUnits += line.qty;

    const actual = data.weightKg != null && data.weightKg > 0 ? data.weightKg : 0;
    const dims = [data.lengthCm, data.widthCm, data.heightCm];
    const hasDimensions =
      dims.every((dimension) => dimension != null && dimension > 0) &&
      dims[0] != null &&
      dims[1] != null &&
      dims[2] != null;
    const volumetric = hasDimensions
      ? (dims[0]! * dims[1]! * dims[2]!) / VOLUMETRIC_DIVISOR
      : 0;

    if (actual === 0 && volumetric === 0) return { ok: false, reason: "weight_missing" };
    weightKg += Math.max(actual, volumetric) * line.qty;
    if (hasDimensions) {
      lengthCm = Math.max(lengthCm ?? 0, dims[0]!);
      widthCm = Math.max(widthCm ?? 0, dims[1]!);
      heightCm = Math.max(heightCm ?? 0, dims[2]!);
    }
  }

  if (shippingUnits === 0) {
    return { ok: true, weightKg: 0, dimensions: { lengthCm: null, widthCm: null, heightCm: null } };
  }
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    return { ok: false, reason: "weight_missing" };
  }

  const rounded = Math.max(0.1, Math.round(weightKg * 100) / 100);
  if (rounded > MPA_MAX_KG) return { ok: false, reason: "too_heavy" };
  return { ok: true, weightKg: rounded, dimensions: { lengthCm, widthCm, heightCm } };
}

interface RateCandidate {
  row: ShippingZoneRow;
  amountCents: number;
  provider: "myparcel-asia" | null;
  mpa?: MpaRate;
  integrationId?: number;
}

/** The public quote plus the internal snapshot order creation persists. */
export interface ResolvedShippingQuote extends ShippingQuote {
  snapshot?: OrderShippingData;
}

function cheapest(candidates: RateCandidate[]): RateCandidate {
  return [...candidates].sort((a, b) => {
    if (a.amountCents !== b.amountCents) return a.amountCents - b.amountCents;
    // Equal price: prefer the stored flat so a provider outage cannot change
    // the number, then follow catalogue order for determinism.
    if (a.provider !== b.provider) return a.provider === null ? -1 : 1;
    return (
      (COURIER_RANK.get(a.row.courierKey) ?? 99) - (COURIER_RANK.get(b.row.courierKey) ?? 99)
    );
  })[0]!;
}

/**
 * Resolve the buyer's destination to one delivery price. Rules:
 *
 * - Zones are tried most-specific first; a zone with no rows is skipped.
 * - Flat rows are always usable. API rows need a MY postcode, a weight, and a
 *   configured MyParcel Asia account.
 * - MPA failure with no flat row in the SAME zone refuses the quote; it never
 *   silently falls back to a broader zone.
 * - With no active rates at all, the legacy flat keeps a brand-new store
 *   selling; once any zone exists, an uncovered destination is refused.
 */
export async function quoteShipping(
  env: Env,
  input: { lines: QuoteLine[]; destination: QuoteDestination },
  deps: QuoteDeps = {},
): Promise<ResolvedShippingQuote> {
  const ships = input.lines.some(
    (line) => (line.row.data.fulfilment ?? { shipment: true }).shipment === true,
  );
  if (!ships) {
    return {
      available: true,
      source: null,
      shippingCents: 0,
      zoneKey: null,
      courierKey: null,
      priceType: null,
      provider: null,
    };
  }

  const active = await shippingZonesModel.listActiveShippingZones(env);
  if (active.length === 0) {
    return {
      available: true,
      source: "fallback",
      shippingCents: ORDER_SHIPPING_CENTS,
      zoneKey: null,
      courierKey: null,
      priceType: null,
      provider: null,
    };
  }

  const country = input.destination.country.trim().toUpperCase();
  const candidates = shippingZoneCandidates(country, input.destination.state ?? "");
  if (candidates.length === 0) return unavailable("no_rate");

  const byZone = new Map<string, ShippingZoneRow[]>();
  for (const row of active) {
    const list = byZone.get(row.zoneKey) ?? [];
    list.push(row);
    byZone.set(row.zoneKey, list);
  }

  const mpaQuote = deps.mpaQuote ?? myParcel.quoteRates;
  let mpaQuoteResult: Promise<MpaQuoteResult> | null = null;
  let parcel: ParcelResult | null = null;

  for (const zoneKey of candidates) {
    const zoneRows = byZone.get(zoneKey);
    if (!zoneRows || zoneRows.length === 0) continue;

    const flats = zoneRows.filter(
      (row) => row.data.priceType === "flat" && row.data.priceCents != null,
    );
    const apiRows = zoneRows.filter(
      (row) => row.data.priceType === "api" || row.data.priceType === "markup",
    );

    const options: RateCandidate[] = flats.map((row) => ({
      row,
      amountCents: row.data.priceCents ?? 0,
      provider: null,
    }));

    if (apiRows.length > 0) {
      if (country !== "MY") {
        // MyParcel Asia quoting is domestic-only. A zone with only API rows
        // is unusable here; a zone with flats can still win.
        if (flats.length === 0) return unavailable("no_rate");
      } else if (!/^\d{5}$/.test(input.destination.postcode ?? "")) {
        if (flats.length === 0) return unavailable("destination_incomplete");
      } else {
        parcel ??= computeParcel(input.lines);
        if (!parcel.ok) {
          if (flats.length === 0) return unavailable(parcel.reason);
        } else {
          mpaQuoteResult ??= mpaQuote(env, {
            receiverPostcode: input.destination.postcode ?? "",
            weightKg: parcel.weightKg,
          });

          let result: MpaQuoteResult | null = null;
          try {
            result = await mpaQuoteResult;
          } catch (error) {
            console.error(
              "myparcel_quote_failed",
              error instanceof Error ? error.message : String(error),
            );
            // A provider failure is refused unless this exact zone also
            // carries a flat rate the merchant configured as an alternative.
            if (flats.length === 0) return unavailable("provider_unavailable");
          }

          if (result) {
            for (const row of apiRows) {
              const rate = result.rates.get(row.courierKey);
              if (!rate) continue;
              const amountCents =
                row.data.priceType === "markup"
                  ? rate.priceCents + (row.data.priceCents ?? 0)
                  : rate.priceCents;
              options.push({
                row,
                amountCents,
                provider: "myparcel-asia",
                mpa: rate,
                integrationId: result.integrationId,
              });
            }
          }
        }
      }
    }

    if (options.length === 0) {
      // The zone exists but nothing in it can price this destination. Refuse
      // rather than quietly charging a broader zone's rate.
      return unavailable("no_rate");
    }

    const best = cheapest(options);
    const snapshot: OrderShippingData = {
      shippingZoneId: best.row.id,
      zoneKey: best.row.zoneKey,
      courierKey: best.row.courierKey,
      priceType: best.row.data.priceType as ShippingPriceType,
      provider: best.provider,
      priceCents: best.amountCents,
      ...(best.provider === "myparcel-asia" && best.mpa
        ? {
            integrationId: best.integrationId,
            providerCode: best.mpa.providerCode,
            providerLabel: best.mpa.providerLabel,
            quotedCents: best.mpa.priceCents,
            ...(best.mpa.transitTime ? { transitTime: best.mpa.transitTime } : {}),
            ...(best.mpa.sendMethods ? { sendMethods: best.mpa.sendMethods } : {}),
            ...(best.mpa.sendDates ? { sendDates: best.mpa.sendDates } : {}),
            ...(parcel && parcel.ok
              ? {
                  parcel: {
                    weightKg: parcel.weightKg,
                    lengthCm: parcel.dimensions.lengthCm,
                    widthCm: parcel.dimensions.widthCm,
                    heightCm: parcel.dimensions.heightCm,
                  },
                }
              : {}),
            quotedAt: klNow(),
          }
        : {}),
    };
    return {
      available: true,
      source: "zone",
      shippingCents: best.amountCents,
      zoneKey: best.row.zoneKey,
      courierKey: best.row.courierKey as ShippingCourierKey,
      priceType: best.row.data.priceType as ShippingPriceType,
      provider: best.provider,
      snapshot,
    };
  }

  return unavailable("no_rate");
}
