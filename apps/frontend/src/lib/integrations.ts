import { INTEGRATION_PROVIDERS } from "@storesy/shared";

/**
 * The app-side half of integrations: the catalogue itself now lives in
 * `@storesy/shared` (one contract for the app and the API — field roles,
 * validation schemas), and this module re-exports what the UI renders from
 * it, plus the UI-only instance state.
 */

export {
  INTEGRATION_PROVIDERS,
  providerOf,
} from "@storesy/shared";
export type {
  IntegrationCategory,
  IntegrationField,
  IntegrationFieldRole,
  IntegrationGuideStep,
  IntegrationProvider,
} from "@storesy/shared";

/** `YYYY-MM-DD HH:MM:SS` (KL) → `12 Oct 2026` for the details modal. */
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatAddedAt(stamp: string): string {
  const [year, month, day] = stamp.slice(0, 10).split("-");
  if (!year || !month || !day) return stamp;
  const label = MONTHS[Number(month) - 1];
  return label ? `${Number(day)} ${label} ${year}` : stamp;
}
