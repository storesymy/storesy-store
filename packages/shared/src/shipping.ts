import { COUNTRIES } from "./countries";

/**
 * Shipping Zone catalogue — the single ordered source for zone and courier
 * keys, shared by the API validator and the SPA dropdown. Rows store the key,
 * never the label, so renaming a zone never needs a data migration.
 */

export interface ShippingZoneOption {
  /** Stable key stored in `shipping_zones.zone_key`. */
  key: string;
  /** Human label shown in the table and dropdown. */
  label: string;
  group: "malaysia" | "state" | "international";
}

/** One selectable rate zone, in the order the merchant sees it. */
export const SHIPPING_ZONES: readonly ShippingZoneOption[] = [
  { key: "my-all", label: "Malaysia - All State", group: "malaysia" },
  { key: "my-peninsular", label: "Peninsular Malaysia", group: "malaysia" },
  { key: "my-sabah-sarawak", label: "Sabah-Sarawak", group: "malaysia" },
  { key: "my-johor", label: "Johor", group: "state" },
  { key: "my-kedah", label: "Kedah", group: "state" },
  { key: "my-kelantan", label: "Kelantan", group: "state" },
  { key: "my-melaka", label: "Melaka", group: "state" },
  { key: "my-negeri-sembilan", label: "Negeri Sembilan", group: "state" },
  { key: "my-pahang", label: "Pahang", group: "state" },
  { key: "my-perak", label: "Perak", group: "state" },
  { key: "my-perlis", label: "Perlis", group: "state" },
  { key: "my-pulau-pinang", label: "Pulau Pinang", group: "state" },
  { key: "my-sabah", label: "Sabah", group: "state" },
  { key: "my-sarawak", label: "Sarawak", group: "state" },
  { key: "my-selangor", label: "Selangor", group: "state" },
  { key: "my-terengganu", label: "Terengganu", group: "state" },
  { key: "my-kuala-lumpur", label: "Kuala Lumpur", group: "state" },
  { key: "my-labuan", label: "Labuan", group: "state" },
  { key: "my-putrajaya", label: "Putrajaya", group: "state" },
  // MY is omitted: "Malaysia - All State" already covers it.
  ...COUNTRIES.filter((country) => country.code !== "MY").map(
    (country): ShippingZoneOption => ({
      key: country.code,
      label: `${country.code} — ${country.name}`,
      group: "international",
    }),
  ),
];

export type ShippingZoneKey = string;

/** The Malaysian state/territory rows (everything between the aggregates and the countries). */
export const SHIPPING_STATE_ZONES: readonly ShippingZoneOption[] = SHIPPING_ZONES.filter(
  (zone) => zone.group === "state",
);

const ZONE_BY_KEY = new Map(SHIPPING_ZONES.map((zone) => [zone.key, zone]));

export function isShippingZoneKey(key: string): boolean {
  return ZONE_BY_KEY.has(key);
}

export function shippingZoneLabel(key: string): string {
  return ZONE_BY_KEY.get(key)?.label ?? key;
}

/** Courier keys and their merchant-facing labels, in display order. */
export const SHIPPING_COURIERS = [
  { key: "jnt", label: "MPA - J&T" },
  { key: "ninjavan", label: "MPA - Ninjavan" },
  { key: "poslaju", label: "MPA - PosLaju" },
  { key: "aramex", label: "MPA - Aramex" },
  { key: "fedex", label: "MPA - Fedex" },
] as const;

export type ShippingCourierKey = (typeof SHIPPING_COURIERS)[number]["key"];

const COURIER_BY_KEY = new Map<string, (typeof SHIPPING_COURIERS)[number]>(
  SHIPPING_COURIERS.map((courier) => [courier.key, courier]),
);

export function isShippingCourierKey(key: string): key is ShippingCourierKey {
  return COURIER_BY_KEY.has(key);
}

export function courierLabel(key: string): string {
  return COURIER_BY_KEY.get(key)?.label ?? key;
}

/** Merchant-facing label without the MPA prefix, e.g. `J&T` for the cart line. */
export function courierShortLabel(key: string): string {
  return courierLabel(key).replace(/^MPA - /, "");
}

/**
 * How the rate is produced: a fixed amount, whatever the shipping API quotes,
 * or API quote + a fixed markup.
 */
export const SHIPPING_PRICE_TYPES = ["flat", "api", "markup"] as const;
export type ShippingPriceType = (typeof SHIPPING_PRICE_TYPES)[number];

export const SHIPPING_PRICE_TYPE_LABELS: Record<ShippingPriceType, string> = {
  flat: "Flat",
  api: "Follow API",
  markup: "API + Markup",
};

export function shippingPriceTypeLabel(priceType: ShippingPriceType): string {
  return SHIPPING_PRICE_TYPE_LABELS[priceType];
}

export const SHIPPING_ZONE_STATUSES = ["active", "inactive"] as const;
export type ShippingZoneStatus = (typeof SHIPPING_ZONE_STATUSES)[number];

export const SHIPPING_ZONE_STATUS_LABELS: Record<ShippingZoneStatus, string> = {
  active: "Active",
  inactive: "Inactive",
};

export function shippingZoneStatusLabel(status: ShippingZoneStatus): string {
  return SHIPPING_ZONE_STATUS_LABELS[status];
}

/** Dropdown options (`value`/`label`) for the SPA's SelectField. */
export const SHIPPING_ZONE_OPTIONS = SHIPPING_ZONES.map(({ key, label }) => ({
  value: key,
  label,
}));

export const SHIPPING_COURIER_OPTIONS = SHIPPING_COURIERS.map(({ key, label }) => ({
  value: key,
  label,
}));

export const SHIPPING_PRICE_TYPE_OPTIONS = SHIPPING_PRICE_TYPES.map((key) => ({
  value: key,
  label: SHIPPING_PRICE_TYPE_LABELS[key],
}));

export const SHIPPING_ZONE_STATUS_OPTIONS = SHIPPING_ZONE_STATUSES.map((key) => ({
  value: key,
  label: SHIPPING_ZONE_STATUS_LABELS[key],
}));

/* ------------------------- checkout zone resolution ------------------------- */

/**
 * Free-text state → lookup key. Drops "W.P."/"Wilayah Persekutuan" prefixes and
 * everything that isn't a letter, so "W.P. Kuala Lumpur" and "Kuala Lumpur"
 * resolve alike.
 */
export function normalizeShippingState(value: string): string {
  return value
    .toLowerCase()
    .replace(/wilayah persekutuan/g, " ")
    .replace(/\bw\.?\s*p\.?/g, " ")
    .replace(/[^a-z]/g, "");
}

const STATE_KEY_BY_NAME = new Map<string, string>();
for (const zone of SHIPPING_STATE_ZONES) {
  STATE_KEY_BY_NAME.set(normalizeShippingState(zone.label), zone.key);
}
// Common labels the select never produces, but older customer records and
// hand-entered addresses may carry.
const STATE_ALIASES: Record<string, string> = {
  penang: "my-pulau-pinang",
  malacca: "my-melaka",
  trengganu: "my-terengganu",
  "n. sembilan": "my-negeri-sembilan",
  kl: "my-kuala-lumpur",
};
for (const [alias, key] of Object.entries(STATE_ALIASES)) {
  STATE_KEY_BY_NAME.set(normalizeShippingState(alias), key);
}

/**
 * Destination → zone keys, most specific first. A Johor buyer checks
 * `my-johor`, then `my-peninsular`, then `my-all`; a Sabah buyer checks
 * `my-sabah`, then `my-sabah-sarawak`, then `my-all`. International buyers
 * check their country's zone only. Empty = no zone can be derived (an unknown
 * Malaysian state), which blocks checkout rather than guessing a price.
 */
export function shippingZoneCandidates(countryCode: string, state: string): string[] {
  const country = countryCode.trim().toUpperCase();
  if (!country) return [];
  if (country !== "MY") return [country];

  const label = state.trim();
  if (!label) return ["my-all"];
  const key = STATE_KEY_BY_NAME.get(normalizeShippingState(label));
  if (!key) return [];
  if (key === "my-sabah" || key === "my-sarawak") {
    return [key, "my-sabah-sarawak", "my-all"];
  }
  // Labuan is neither peninsular nor part of the Sabah-Sarawak label; only a
  // specific Labuan rate or the nationwide rate applies.
  if (key === "my-labuan") return [key, "my-all"];
  return [key, "my-peninsular", "my-all"];
}

/** The fields the checkout needs from one active rate. */
export interface ShippingRateQuote {
  zoneKey: string;
  courierKey: ShippingCourierKey;
  priceType: ShippingPriceType;
  priceCents: number | null;
}

const COURIER_RANK = new Map<string, number>(
  SHIPPING_COURIERS.map((courier, index) => [courier.key, index]),
);

/** Whether any active rate can be charged today (a concrete flat amount). */
export function hasPriceableShippingRates(rates: readonly ShippingRateQuote[]): boolean {
  return rates.some(
    (rate) => rate.priceType === "flat" && typeof rate.priceCents === "number",
  );
}

/**
 * First candidate zone with a priceable rate. Only `flat` is priceable today —
 * `api`/`markup` need a live courier quote, which no integration supplies yet.
 * Within a zone the cheapest flat rate wins; ties follow catalogue order.
 */
export function pickShippingRate(
  rates: readonly ShippingRateQuote[],
  candidates: readonly string[],
): ShippingRateQuote | null {
  for (const zoneKey of candidates) {
    const usable = rates.filter(
      (rate) =>
        rate.zoneKey === zoneKey &&
        rate.priceType === "flat" &&
        typeof rate.priceCents === "number",
    );
    if (usable.length === 0) continue;
    usable.sort(
      (a, b) =>
        (a.priceCents ?? 0) - (b.priceCents ?? 0) ||
        (COURIER_RANK.get(a.courierKey) ?? 99) - (COURIER_RANK.get(b.courierKey) ?? 99),
    );
    return usable[0] ?? null;
  }
  return null;
}
