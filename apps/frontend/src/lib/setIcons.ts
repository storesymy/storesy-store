/**
 * Page icon sets — the check that marks feature cards and the chevron on FAQ
 * rows, drawn from five open-source icon libraries. Path data is copied from
 * each project's own SVGs:
 *
 * - Bootstrap Icons (MIT)
 * - Heroicons (MIT)
 * - Lucide (ISC)
 * - Font Awesome Free icons (CC BY 4.0) — https://fontawesome.com/license/free
 * - Hugeicons free icons (@hugeicons/core-free-icons)
 */
export type IconSetId = "bootstrap" | "heroicons" | "lucide" | "fontawesome" | "hugeicons";
export type SetGlyphName = "check" | "chevron";

export interface SetGlyph {
  viewBox: string;
  paths: string[];
  /** Stroke width for stroked glyphs — absent means the glyph is filled. */
  stroke?: number;
  fillRule?: "evenodd";
}

export interface IconSetDef {
  id: IconSetId;
  label: string;
  check: SetGlyph;
  chevron: SetGlyph;
}

export const ICON_SETS: Record<IconSetId, IconSetDef> = {
  bootstrap: {
    id: "bootstrap",
    label: "Bootstrap Icon",
    check: {
      viewBox: "0 0 16 16",
      paths: [
        "M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425z",
      ],
    },
    chevron: {
      viewBox: "0 0 16 16",
      fillRule: "evenodd",
      paths: [
        "M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708",
      ],
    },
  },
  heroicons: {
    id: "heroicons",
    label: "Hero Icon",
    check: { viewBox: "0 0 24 24", stroke: 1.5, paths: ["m4.5 12.75 6 6 9-13.5"] },
    chevron: { viewBox: "0 0 24 24", stroke: 1.5, paths: ["m19.5 8.25-7.5 7.5-7.5-7.5"] },
  },
  lucide: {
    id: "lucide",
    label: "Lucide Icon",
    check: { viewBox: "0 0 24 24", stroke: 2, paths: ["M20 6 9 17l-5-5"] },
    chevron: { viewBox: "0 0 24 24", stroke: 2, paths: ["m6 9 6 6 6-6"] },
  },
  fontawesome: {
    id: "fontawesome",
    label: "Font-awesome",
    check: {
      viewBox: "0 0 448 512",
      paths: [
        "M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z",
      ],
    },
    chevron: {
      viewBox: "0 0 512 512",
      paths: [
        "M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 86.6 169.4c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l192 192z",
      ],
    },
  },
  hugeicons: {
    id: "hugeicons",
    label: "Hugeicons",
    check: {
      viewBox: "0 0 24 24",
      stroke: 1.5,
      paths: ["M5 14L8.5 17.5L19 6.5"],
    },
    chevron: {
      viewBox: "0 0 24 24",
      stroke: 1.5,
      paths: ["M18 9.00005C18 9.00005 13.5811 15 12 15C10.4188 15 6 9 6 9"],
    },
  },
};

export const ICON_SET_LIST: IconSetDef[] = [
  ICON_SETS.bootstrap,
  ICON_SETS.heroicons,
  ICON_SETS.lucide,
  ICON_SETS.fontawesome,
  ICON_SETS.hugeicons,
];

export function isIconSet(value: unknown): value is IconSetId {
  return typeof value === "string" && value in ICON_SETS;
}
