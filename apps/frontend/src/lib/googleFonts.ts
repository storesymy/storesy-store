import { GOOGLE_FONTS } from "./googleFontCatalog";
import type { FontCategoryName, GoogleFontEntry } from "./googleFontCatalog";

export type { GoogleFontEntry };
export { FONT_CATEGORY_ORDER } from "./googleFontCatalog";

/**
 * Google Fonts for sales pages — the nine families the Style tab offers up
 * front (3 sans, 3 serif, 3 mono); the picker modal browses the full
 * generated catalogue in `googleFontCatalog.ts`. Stylesheets are injected
 * lazily with each family's exact weight list, so a request never 400s.
 */
export const DEFAULT_FONT_GROUPS: ReadonlyArray<{
  label: string;
  category: FontCategoryName;
  families: string[];
}> = [
  { label: "Sans Serif", category: "Sans Serif", families: ["Inter", "Poppins", "Roboto"] },
  {
    label: "Serif",
    category: "Serif",
    families: ["Playfair Display", "Merriweather", "Lora"],
  },
  {
    label: "Monospace",
    category: "Monospace",
    families: ["JetBrains Mono", "Roboto Mono", "Fira Code"],
  },
];

export const DEFAULT_FONTS: string[] = DEFAULT_FONT_GROUPS.flatMap((group) => group.families);

/** Values older drafts stored before Google Fonts — still renderable stacks. */
const SYSTEM_STACKS: Record<string, string> = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  rounded: 'ui-rounded, "Hiragino Maru Gothic ProN", Quicksand, "Varela Round", sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

const LEGACY_LABELS: Record<string, string> = {
  system: "System Sans",
  serif: "Serif",
  rounded: "Rounded",
  mono: "Mono",
};

const CATEGORY_FALLBACK: Record<FontCategoryName, string> = {
  "Sans Serif": 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  Serif: 'Georgia, "Times New Roman", serif',
  Monospace: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  Display: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  Handwriting: '"Segoe Script", "Bradley Hand", "Comic Sans MS", cursive',
};

const INDEX = new Map<string, GoogleFontEntry>(GOOGLE_FONTS.map((entry) => [entry.family, entry]));

export function findGoogleFont(family: string): GoogleFontEntry | null {
  return INDEX.get(family) ?? null;
}

export function isGoogleFont(family: string): boolean {
  return INDEX.has(family);
}

/** Display name for a style value — legacy system ids get friendly labels. */
export function fontLabel(family: string): string {
  return LEGACY_LABELS[family] ?? family;
}

/**
 * CSS stack for a stored font value: the Google family first (once its
 * stylesheet is in), then a same-category local fallback so the page still
 * reads correctly offline.
 */
export function fontStack(family: string): string {
  const system = SYSTEM_STACKS[family];
  if (system !== undefined) return system;
  const entry = INDEX.get(family);
  if (entry) return `"${family}", ${CATEGORY_FALLBACK[entry.category]}`;
  return SYSTEM_STACKS["system"] ?? "system-ui, sans-serif";
}

const loaded = new Set<string>();

/**
 * The exact-weights stylesheet address for one family — the link the Style
 * tab injects at runtime and the `<link>` the public document bakes into its
 * `<head>`. Null for unknown families and legacy system stacks.
 */
export function googleFontHref(family: string): string | null {
  const entry = INDEX.get(family);
  if (!entry || entry.weights.length === 0) return null;
  const name = encodeURIComponent(family).replace(/%20/g, "+");
  return `https://fonts.googleapis.com/css2?family=${name}:wght@${entry.weights.join(";")}&display=swap`;
}

/** Injects one Google Fonts stylesheet per family (idempotent, cached). */
export function ensureGoogleFont(family: string): void {
  if (loaded.has(family)) return;
  const href = googleFontHref(family);
  if (!href) return;
  loaded.add(family);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}
