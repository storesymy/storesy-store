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
