import { routes } from "@storesy/shared";

/** Cents → display ringgit (`RM19.90`) — the store's currency is MYR. */
export function formatPrice(cents: number): string {
  return `RM${(cents / 100).toFixed(2)}`;
}

/** Stored R2 path → URL the SPA renders (same-origin through the /api proxy). */
export function imageSrc(path: string): string {
  return `${routes.images}/${path}`;
}

/** Bytes → human size for chips (`12.4 MB`). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * User-typed price ("19.90", tolerating a pasted "RM" prefix) → cents.
 * Returns null when it isn't a plain amount with at most two decimals.
 */
export function priceToCents(input: string): number | null {
  const normalized = input.trim().replace(/^rm\s*/i, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

/**
 * Optional unit input (weight kg, dimensions cm) → number. Empty means unset
 * (null); anything that isn't a plain decimal (up to 3 decimals) yields NaN
 * so the form can flag it before saving.
 */
export function parseUnit(input: string): number | null {
  const normalized = input.trim();
  if (normalized === "") return null;
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}
