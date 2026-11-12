/**
 * UUIDv7 identifiers.
 *
 * Guideline (every model table, now and in the future): a model carries a
 * `uuid` column holding a UUID **v7** — a 48-bit millisecond timestamp comes
 * first, so ids sort by creation time — prefixed with the first three letters
 * of the object name for readability in logs, URLs and support tickets:
 *
 *   User → `usr-…`, Product → `prd-…`, Order → `ord-…`
 *
 * The bigint autoincrement `id` is the internal key (foreign keys reference
 * it); `uuid` is the public key (what APIs return and sessions carry).
 */

/** Canonical three-letter prefixes for model ids. */
export const ID_PREFIX = {
  user: "usr",
  product: "prd",
  order: "ord",
  customer: "cus",
  contact: "cdt",
  salesPage: "spg",
  emailTemplate: "tpl",
  gmailOAuthFlow: "gpo",
} as const;

/** Raw UUIDv7: `xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx` (y = 8/9/a/b). */
export function uuidv7(): string {
  // 48-bit unix timestamp in milliseconds.
  const timeHex = Date.now().toString(16).padStart(12, "0");
  // 10 random bytes: 12 (rand_a) + 16 (variant+rand_b) + 48 (rest of rand_b).
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const view = new DataView(bytes.buffer);
  const version = 0x7000 | (view.getUint16(0) & 0x0fff); // version 7 + rand_a
  const variant = 0x8000 | (view.getUint16(2) & 0x3fff); // variant 10xx + rand_b
  const tail = Array.from(bytes.subarray(4), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return [
    timeHex.slice(0, 8),
    timeHex.slice(8, 12),
    version.toString(16).padStart(4, "0"),
    variant.toString(16).padStart(4, "0"),
    tail,
  ].join("-");
}

/** Prefixed UUIDv7 for an entity, e.g. `usr-0199f3c2-…`. */
export function entityUuid(prefix: string): string {
  return `${prefix}-${uuidv7()}`;
}
