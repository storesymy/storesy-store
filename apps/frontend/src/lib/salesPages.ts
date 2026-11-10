import type { IconName } from "@storesy/ui";
import type {
  Product,
  SalesPage as ApiSalesPage,
  SalesPageSummary,
  UpdateSalesPageInput,
} from "@storesy/shared";
import { ORDER_SHIPPING_CENTS, SALESPAGE_HTML_MAX_BYTES } from "@storesy/shared";
import { ApiError, api } from "./api";
import { fontStack } from "./googleFonts";
import { buildSalesPageDocument } from "./salesPageDocument";
import { isIconSet } from "./setIcons";
import type { IconSetId } from "./setIcons";

// The list table's row shape — re-exported so pages import one module.
export type { SalesPageSummary };

/**
 * Sales Pages — model, pure helpers and the persistence layer. Storage is
 * real: every page is a D1 row and its documents are static R2 files, reached
 * through `/api/salespages`. The pure helpers (sections, style, slug, HTML
 * decisions) never touch the network; the load/save functions below are async
 * and mirror the API's contracts (404 → null, slug 409 surfaces as ApiError).
 */

export type SalesPageStatus = "open" | "closed";

/**
 * Which editor authors this page's HTML (the Action card select):
 * `"component"` = Component Editor (sections + Style tab), `"code"` = Import
 * Editor (custom or imported HTML), `"ai"` = AI Editor.
 */
export type SalesPageHtmlType = "component" | "code" | "ai";

export type SectionType =
  | "hero"
  | "biglist"
  | "countdown"
  | "cta"
  | "features"
  | "testimonial"
  | "faq"
  | "footer"
  | "featured-image"
  | "carousel"
  | "image-info"
  | "gallery"
  | "image-text";

export interface SalesSectionItem {
  id: string;
  /** Primary line — the list row, feature, question or quote. */
  text: string;
  /** Secondary line — the detail under it ("" for plain lists). */
  detail: string;
}

export interface SalesSection {
  id: string;
  type: SectionType;
  title: string;
  subtitle: string;
  buttonLabel: string;
  /** Countdown target as an ISO string — only read by the countdown type. */
  target: string;
  items: SalesSectionItem[];
  /** Media for the image components — `ph:<id>` preset art, or an image URL. */
  images: string[];
}

export interface SalesPage {
  id: string;
  name: string;
  slug: string;
  status: SalesPageStatus;
  /** Fake social proof for the list table. */
  visits: number;
  seo: { title: string; description: string; keywords: string };
  og: { title: string; description: string; image: string };
  sections: SalesSection[];
  /** Visual theme applied to the canvas (fonts, colors, size, spacing, icons). */
  style: SalesPageStyle;
  /**
   * Product ids the bottom-most checkout block sells, in listing order —
   * picked in the Checkout tab ("Select Product"). The block renders exactly
   * these (active ones only, like the store), so a page sells what its editor
   * chose instead of the whole catalogue. Empty = nothing for sale here.
   */
  checkoutProducts: string[];
  /** Payment-gateway integration the checkout charges through (`itg-…`), or none. */
  paymentGateway: string | null;
  /** Email-sending integration (`itg-…`, Email category), or none. */
  emailSender: string | null;
  /** Tracking integrations the page reports to (`itg-…`), in add order. */
  trackings: string[];
  /**
   * One HTML document per editor type — Component Editor, Import Editor and
   * AI Editor each own their markup (`htmlByType.component` / `.code` /
   * `.ai`), so editing one type's source never touches the others. A missing
   * key means that type has no override yet: the Component canvas renders its
   * sections, and Code/AI show the generated source until typed into.
   */
  htmlByType: Partial<Record<SalesPageHtmlType, string>>;
  /**
   * Set when the Import Editor's document (`htmlByType.code`) came from the
   * URL importer: the canvas and `/:slug` mount it in a sandboxed iframe —
   * the source's own scripts run, sealed off from the app (cookies, storage,
   * API). Absent = hand-edited Code HTML, injected inline exactly as before.
   */
  htmlMode?: "snapshot";
  /** Where the Import Editor's document came from (re-import / badge, round 2). */
  source?: { url: string; importedAt: string };
  /**
   * The Action card's "type of HTML" pick — also whose document is live on
   * the canvas and at `/:slug`. Absent on older pages — derived
   * (`custom HTML → "code"`, else `"component"`); stored once chosen.
   */
  htmlType?: SalesPageHtmlType;
  /**
   * @deprecated The pre-split single document. Migrated into `htmlByType`
   * under the type that owned it on load, then dropped — nothing writes it.
   */
  html?: string | null;
  /** `Y-m-d H:i:s` Asia/Kuala_Lumpur — the app's date-time convention. */
  createdAt: string;
  updatedAt: string;
}

/**
 * Which editor owns the page's live document: the stored Action card pick,
 * or derived for older pages (a custom document means the Import Editor,
 * otherwise the Component Editor).
 */
export function htmlTypeOf(page: SalesPage): SalesPageHtmlType {
  return page.htmlType ?? (page.htmlByType.code != null ? "code" : "component");
}

/**
 * That editor's HTML — `null` means no override yet, so the canvas and
 * `/:slug` fall back to the type's own render (sections for Component, the
 * generated source for Code/AI).
 */
export function htmlFor(
  page: SalesPage,
  type: SalesPageHtmlType = htmlTypeOf(page),
): string | null {
  return page.htmlByType[type] ?? null;
}

/**
 * True when the live document came from the URL importer. Provenance only —
 * it picks the "Imported page" badge. Framing and the checkout rider follow
 * `isFramedHtml` instead, which any complete document earns. Imports always
 * land in the Import Editor's slot, so other types never inherit the flag.
 */
export function isSnapshotHtml(
  page: SalesPage,
  type: SalesPageHtmlType = htmlTypeOf(page),
): boolean {
  return type === "code" && page.htmlMode === "snapshot" && htmlFor(page, "code") !== null;
}

/**
 * True when the HTML is a complete document — a doctype or a root element —
 * rather than a fragment of markup. Injected inline, a complete document
 * loses its structure (the parser drops `<html>`, `<head>` and `<body>`), so
 * its own `body` rules never reach a body element, its stylesheet leaks across
 * the whole editor, and the canvas paints over whatever it meant as its
 * background. A complete document has to own a window of its own.
 *
 * Leading comments don't change what a document is — pages saved off the web
 * routinely open with `<!-- saved from url=… -->`.
 */
export function isFullDocumentHtml(html: string): boolean {
  return /^\s*(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\b|<(?:html|head|body)(?=[\s/>]))/i.test(
    html,
  );
}

/**
 * Whether the live document must mount in a sandboxed frame: an imported page
 * (`htmlMode: "snapshot"`) or any complete document typed or pasted into the
 * Code view. A fragment — the generated sections HTML, or hand-written markup —
 * renders inline on the canvas instead, so the page's Style (theme, spacing,
 * content width) still paints it.
 */
export function isFramedHtml(
  page: SalesPage,
  type: SalesPageHtmlType = htmlTypeOf(page),
): boolean {
  const html = htmlFor(page, type);
  if (html === null) return false;
  return isSnapshotHtml(page, type) || isFullDocumentHtml(html);
}

/** One draggable section in the editor's Sections tab. */
export interface SectionKind {
  type: SectionType;
  label: string;
  hint: string;
  icon: IconName;
  /** Sections that carry editable rows (list / features / FAQ). */
  hasItems: boolean;
}

export const SECTION_KINDS: SectionKind[] = [
  {
    type: "hero",
    label: "Hero Section",
    hint: "Headline, subline and a button",
    icon: "layout",
    hasItems: false,
  },
  {
    type: "biglist",
    label: "Big List",
    hint: "Numbered benefit list",
    icon: "check",
    hasItems: true,
  },
  {
    type: "countdown",
    label: "Countdown Timer",
    hint: "Live urgency timer",
    icon: "clock",
    hasItems: false,
  },
  {
    type: "cta",
    label: "CTA Banner",
    hint: "Call-to-action strip with a button",
    icon: "cart",
    hasItems: false,
  },
  {
    type: "features",
    label: "Features",
    hint: "Cards with title and detail",
    icon: "palette",
    hasItems: true,
  },
  {
    type: "testimonial",
    label: "Testimonial",
    hint: "Customer quote and attribution",
    icon: "share",
    hasItems: false,
  },
  {
    type: "faq",
    label: "FAQ",
    hint: "Questions with expandable answers",
    icon: "search",
    hasItems: true,
  },
  {
    type: "footer",
    label: "Footer",
    hint: "Brand line and copyright",
    icon: "arrowDown",
    hasItems: false,
  },
  {
    type: "featured-image",
    label: "Featured Image",
    hint: "One large image with a caption",
    icon: "image",
    hasItems: false,
  },
  {
    type: "carousel",
    label: "Image Carousel",
    hint: "Slides with arrows and dots",
    icon: "refresh",
    hasItems: false,
  },
  {
    type: "image-info",
    label: "Image + Info List",
    hint: "Image beside a spec list",
    icon: "bag",
    hasItems: true,
  },
  {
    type: "gallery",
    label: "Gallery",
    hint: "Grid of product images",
    icon: "layout",
    hasItems: false,
  },
  {
    type: "image-text",
    label: "Image + Text",
    hint: "Copy and a button beside an image",
    icon: "monitor",
    hasItems: false,
  },
];

export function kindFor(type: SectionType): SectionKind {
  return SECTION_KINDS.find((kind) => kind.type === type) ?? SECTION_KINDS[0]!;
}

/** Rows a list-style section may grow to (canvas stays tidy). */
export const SECTION_ITEM_MAX = 6;

/** Slides or tiles an image section may grow to. */
export const SECTION_IMAGE_MAX = 6;

/**
 * Built-in art for the image components — the fake-data phase has no photo
 * library yet, so slots ship with designed gradient presets (and any real URL
 * can replace one). The ids map to the `.simg--<id>` styles.
 */
export const IMAGE_PLACEHOLDERS = [
  { id: "dune", label: "Dune" },
  { id: "tide", label: "Tide" },
  { id: "moss", label: "Moss" },
  { id: "ember", label: "Ember" },
  { id: "plum", label: "Plum" },
  { id: "slate", label: "Slate" },
  { id: "mint", label: "Mint" },
  { id: "rose", label: "Rose" },
  { id: "indigo", label: "Indigo" },
  { id: "sand", label: "Sand" },
];

/** `true` for built-in preset art (`ph:mint`); anything else is a URL. */
export function isPlaceholderImage(src: string): boolean {
  return /^ph:[a-z]+$/.test(src);
}

/** Preset id for a slot value — falls back to Slate for URLs and junk. */
export function placeholderId(src: string): string {
  return /^ph:([a-z]+)$/.exec(src)?.[1] ?? "slate";
}

/* ---- Style: fonts, icon set, colors, size, whitespace ---- */

export type SizeStop = "xs" | "sm" | "md" | "lg" | "xl";
export const SIZE_STOPS: SizeStop[] = ["xs", "sm", "md", "lg", "xl"];

/** Multiplier per Font Size stop — `md` (the default) keeps design sizes. */
export const FONT_SIZE_SCALE: Record<SizeStop, number> = {
  xs: 0.85,
  sm: 0.92,
  md: 1,
  lg: 1.1,
  xl: 1.2,
};

/** Multiplier per Whitespace stop — `sm` (the default) is the design rhythm. */
export const WHITESPACE_SCALE: Record<SizeStop, number> = {
  xs: 0.75,
  sm: 1,
  md: 1.15,
  lg: 1.35,
  xl: 1.6,
};

export function isSizeStop(value: unknown): value is SizeStop {
  return typeof value === "string" && SIZE_STOPS.includes(value as SizeStop);
}

/** Content width: full to the screen edges, or a centered fixed column. */
export type WidthMode = "full" | "fixed";

/** The bottom-most checkout block: shown to buyers, or hidden entirely. */
export type CheckoutMode = "show" | "none";

/**
 * Flat shipping shown in the cart when it holds an item that ships — the
 * same constant the order service charges server-side (shared, so the
 * document's script, the editor preview and the API can never disagree).
 */
export const FAKE_SHIPPING_CENTS = ORDER_SHIPPING_CENTS;

/** Fixed-mode column width (px) and its editable bounds. */
export const DEFAULT_WRAP_WIDTH = 860;
export const WRAP_MIN = 320;
export const WRAP_MAX = 1400;

export function clampWrapWidth(px: number): number {
  return Math.min(WRAP_MAX, Math.max(WRAP_MIN, Math.round(px)));
}

export interface SalesPageStyle {
  /** Google Fonts family (or a legacy system id) for headings. */
  fontHead: string;
  /** Google Fonts family (or a legacy system id) for body copy. */
  fontBody: string;
  /** Page-wide type scale — `md` = the design default. */
  fontSize: SizeStop;
  /** Vertical rhythm: margins, paddings and gaps — `sm` = the design default. */
  whitespace: SizeStop;
  accent: string;
  background: string;
  text: string;
  /** Corner radius multiplier over each element's own base radius. */
  radiusScale: number;
  iconSet: IconSetId;
  /** Content/wrapper width of every component: full to screen, or fixed. */
  width: WidthMode;
  /** Fixed-mode column width in px — only read when `width` is "fixed". */
  wrapWidth: number;
  /** Bottom-most checkout block (product listing → cart → details → pay). */
  checkout: CheckoutMode;
}

/**
 * A theme is a complete look: colors plus the typography, size, whitespace and
 * corner radius it was designed with. The icon set, content width and checkout
 * block are page-owned, not themed.
 */
export interface ThemePreset {
  id: string;
  label: string;
  style: Omit<SalesPageStyle, "iconSet" | "width" | "wrapWidth" | "checkout">;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "bold-pop",
    label: "Bold Pop",
    style: {
      accent: "#FF6500",
      background: "#FFFFFF",
      text: "#14181F",
      fontHead: "Inter",
      fontBody: "Inter",
      fontSize: "md",
      whitespace: "sm",
      radiusScale: 1,
    },
  },
  {
    id: "elegant-serif",
    label: "Elegant Serif",
    style: {
      accent: "#881337",
      background: "#FFFBF5",
      text: "#292524",
      fontHead: "Playfair Display",
      fontBody: "Lora",
      fontSize: "lg",
      whitespace: "lg",
      radiusScale: 1.5,
    },
  },
  {
    id: "playful-rounded",
    label: "Playful Rounded",
    style: {
      accent: "#DB2777",
      background: "#FFFFFF",
      text: "#1F1330",
      fontHead: "Poppins",
      fontBody: "Poppins",
      fontSize: "lg",
      whitespace: "md",
      radiusScale: 2,
    },
  },
  {
    id: "tech-mono",
    label: "Tech Mono",
    style: {
      accent: "#0F766E",
      background: "#FFFFFF",
      text: "#0F172A",
      fontHead: "JetBrains Mono",
      fontBody: "Roboto",
      fontSize: "sm",
      whitespace: "xs",
      radiusScale: 0.5,
    },
  },
  {
    id: "midnight-dark",
    label: "Midnight Dark",
    style: {
      accent: "#38BDF8",
      background: "#0B1220",
      text: "#E5E7EB",
      fontHead: "Inter",
      fontBody: "Roboto",
      fontSize: "lg",
      whitespace: "md",
      radiusScale: 1.2,
    },
  },
];

/** True when the page matches a preset across every field the theme owns. */
export function themeMatches(style: SalesPageStyle, preset: ThemePreset): boolean {
  const owned = preset.style;
  return (Object.keys(owned) as Array<keyof typeof owned>).every(
    (key) => style[key] === owned[key],
  );
}

function rgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const digits = match?.[1];
  if (!digits) return null;
  const value = Number.parseInt(digits, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Blend `from` toward `to` — t = 0 keeps `from`, t = 1 is fully `to`. */
export function mix(from: string, to: string, t: number): string {
  const a = rgb(from);
  const b = rgb(to);
  if (!a || !b) return to;
  const [ar, ag, ab] = a;
  const [br, bg, bb] = b;
  const channel = (start: number, end: number) => Math.round(start * (1 - t) + end * t);
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(channel(ar, br))}${hex(channel(ag, bg))}${hex(channel(ab, bb))}`.toUpperCase();
}

/** WCAG relative luminance of a 6-digit hex color. */
function luminance(hex: string): number | null {
  const color = rgb(hex);
  if (!color) return null;
  const [r, g, b] = color;
  const lin = (channel: number) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Readable foreground for a background — the crossover where white and near-black
 * score the same contrast (WCAG 2.x). Keeps the default orange on dark ink text.
 */
export function readableOn(hex: string): string {
  const value = luminance(hex);
  if (value === null) return "#14181F";
  return value > 0.179 ? "#14181F" : "#FFFFFF";
}

/**
 * The default document is the first theme (Bold Pop) with the default icon
 * set and full-width content — so a freshly created page always shows an
 * active theme chip.
 */
export function defaultStyle(): SalesPageStyle {
  return {
    ...THEME_PRESETS[0]!.style,
    iconSet: "lucide",
    width: "full",
    wrapWidth: DEFAULT_WRAP_WIDTH,
    // A sales page sells — the checkout block is on unless turned off.
    checkout: "show",
  };
}

/**
 * Canvas-scoped custom properties: the section styles already read `--sfv-*`,
 * so overriding them (plus the `--sp-*` scale tokens) themes the page live.
 */
export function canvasStyleVars(style: SalesPageStyle): Record<string, string> {
  // Soft accent band (testimonial, dots) stays white-tinted, so its text needs
  // its own foreground — light themes keep near-black, dark themes flip dark.
  const brandSoft = mix(style.accent, "#FFFFFF", 0.9);
  const onSoft = readableOn(brandSoft);
  return {
    fontFamily: fontStack(style.fontBody),
    "--sp-font-head": fontStack(style.fontHead),
    "--sp-fs": String(FONT_SIZE_SCALE[style.fontSize] ?? 1),
    "--sp-space": String(WHITESPACE_SCALE[style.whitespace] ?? 1),
    "--sp-rscale": String(style.radiusScale),
    // Content column: fixed pages center a wrapWidth column, full pages stretch.
    "--sp-wrapmax": style.width === "fixed" ? `${clampWrapWidth(style.wrapWidth)}px` : "100%",
    "--sp-onaccent": readableOn(style.accent),
    "--sp-onink": readableOn(style.text),
    // Foreground for the inverse button that sits ON the accent foreground.
    "--sp-onbtn": readableOn(readableOn(style.accent)),
    "--sp-onsoft": onSoft,
    "--sp-softonsoft": mix(onSoft, brandSoft, 0.45),
    "--sfv-brand": style.accent,
    "--sfv-brand-soft": brandSoft,
    "--sfv-brand-line": mix(style.accent, "#FFFFFF", 0.7),
    "--sfv-bg": style.background,
    "--sfv-ink": style.text,
    "--sfv-soft": mix(style.text, style.background, 0.45),
    "--sfv-line": mix(style.text, style.background, 0.9),
    "--sfv-line-strong": mix(style.text, style.background, 0.78),
  };
}

function uid(): string {
  return crypto.randomUUID();
}

function item(text: string, detail = ""): SalesSectionItem {
  return { id: uid(), text, detail };
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/** Starter copy for one component — what the user gets when they drop it in. */
export function defaultSection(type: SectionType): SalesSection {
  const base: SalesSection = {
    id: uid(),
    type,
    title: "",
    subtitle: "",
    buttonLabel: "",
    target: "",
    items: [],
    images: [],
  };

  switch (type) {
    case "hero":
      return {
        ...base,
        title: "Built to be kept",
        subtitle: "One honest product, made properly — the last one you need to buy.",
        buttonLabel: "Get it now",
      };
    case "biglist":
      return {
        ...base,
        title: "Why people love it",
        items: [
          item("Solid materials, zero plastic"),
          item("Ships within 48 hours"),
          item("30-day money-back guarantee"),
        ],
      };
    case "countdown":
      return { ...base, title: "Offer ends in", target: isoDaysFromNow(3) };
    case "cta":
      return {
        ...base,
        title: "Ready when you are",
        subtitle: "Free shipping today only — discount applied at checkout.",
        buttonLabel: "Claim my discount",
      };
    case "features":
      return {
        ...base,
        title: "Everything you need",
        items: [
          item("Free shipping", "On every order over RM50, delivered in 48 hours."),
          item("2-year warranty", "If anything breaks we replace it — no questions asked."),
          item("Real support", "Talk to a human, seven days a week."),
        ],
      };
    case "testimonial":
      return {
        ...base,
        title: "“Best purchase I've made this year — it arrived the next day and works perfectly.”",
        subtitle: "Aina R. · verified buyer",
      };
    case "faq":
      return {
        ...base,
        title: "Questions, answered",
        items: [
          item("How long does delivery take?", "Orders ship within 24 hours and arrive in 2–3 business days."),
          item("Can I return it?", "Yes — 30 days, free returns, no questions asked."),
          item("Do you ship internationally?", "We ship across Malaysia and Singapore, with more regions coming soon."),
        ],
      };
    case "footer":
      return {
        ...base,
        title: "Storesy Store",
        subtitle: "© 2026 · Powered by Storesy",
      };
    case "featured-image":
      return {
        ...base,
        title: "See it up close",
        subtitle: "Studio shot — true colour, nothing hidden.",
        images: ["ph:dune"],
      };
    case "carousel":
      return {
        ...base,
        title: "Every angle",
        subtitle: "Tap through the details",
        images: ["ph:tide", "ph:moss", "ph:ember"],
      };
    case "image-info":
      return {
        ...base,
        title: "What it's made of",
        subtitle: "The details that matter, up front.",
        items: [
          item("Material", "Solid oak, hand-finished"),
          item("In the box", "Unit, cable, spare parts"),
          item("Warranty", "2 years, no questions"),
          item("Ships from", "Kuala Lumpur, in 24h"),
        ],
        images: ["ph:plum"],
      };
    case "gallery":
      return {
        ...base,
        title: "From the studio",
        images: ["ph:sand", "ph:mint", "ph:rose", "ph:indigo", "ph:dune", "ph:slate"],
      };
    case "image-text":
      return {
        ...base,
        title: "Designed around your day",
        subtitle:
          "Light that follows you from morning focus to evening wind-down — no apps, no accounts.",
        buttonLabel: "See how it works",
        images: ["ph:slate"],
      };
  }
}

/** `summer-mega-sale` from anything typed — the URL-safe slug. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

/** Wall-clock stamp `Y-m-d H:i:s` in Asia/Kuala_Lumpur (app convention). */
export function stamp(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .format(date)
    .replace(",", "");
}

export function nowStamp(): string {
  return stamp(new Date());
}

/** `2 hours ago` from a `YYYY-MM-DD HH:MM:SS` Asia/Kuala_Lumpur wall-clock. */
export function relativeTime(stored: string): string {
  const then = Date.parse(`${stored.replace(" ", "T")}+08:00`);
  if (!Number.isFinite(then)) return stored;
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}

/** Stored style → a fully-typed document: fills anything a row left out. */
function normalizeStyle(raw: SalesPageStyle | undefined): SalesPageStyle {
  const source = (raw ?? {}) as Partial<SalesPageStyle> & Record<string, unknown>;
  const defaults = defaultStyle();
  const text = (value: unknown, fallback: string): string =>
    typeof value === "string" && value.length > 0 ? value : fallback;
  return {
    fontHead: text(source.fontHead, defaults.fontHead),
    fontBody: text(source.fontBody, defaults.fontBody),
    fontSize: isSizeStop(source.fontSize) ? source.fontSize : defaults.fontSize,
    whitespace: isSizeStop(source.whitespace) ? source.whitespace : defaults.whitespace,
    accent: text(source.accent, defaults.accent),
    background: text(source.background, defaults.background),
    text: text(source.text, defaults.text),
    radiusScale:
      typeof source.radiusScale === "number" && source.radiusScale >= 0
        ? source.radiusScale
        : defaults.radiusScale,
    iconSet: isIconSet(source.iconSet) ? source.iconSet : defaults.iconSet,
    width: source.width === "fixed" ? "fixed" : "full",
    wrapWidth:
      typeof source.wrapWidth === "number" && Number.isFinite(source.wrapWidth)
        ? clampWrapWidth(source.wrapWidth)
        : defaults.wrapWidth,
    checkout: source.checkout === "none" ? "none" : "show",
  };
}

/* ------------------------------ persistence ------------------------------ */

/**
 * Wire → local: the API returns sections/style opaque (their schema belongs
 * to the SPA), so hydrate them into the app's types and harden what a
 * server-created page may have left empty — default style, images lists.
 */
function fromWire(payload: ApiSalesPage): SalesPage {
  const sections = (payload.sections ?? []) as SalesSection[];
  return {
    ...payload,
    sections: sections.map((section) => ({ ...section, images: section.images ?? [] })),
    style: normalizeStyle(payload.style as SalesPageStyle | undefined),
    checkoutProducts: payload.checkoutProducts ?? [],
    paymentGateway: payload.paymentGateway ?? null,
    emailSender: payload.emailSender ?? null,
    trackings: payload.trackings ?? [],
    htmlByType: payload.htmlByType ?? {},
  } as SalesPage;
}

/**
 * What the server last confirmed for a page — the diff base a save compares
 * against, so an autosave sends only the documents that actually changed (a
 * 1 MB imported document rides the wire once, not on every 600 ms pause) and
 * knows snapshot provenance must be *cleared* with an explicit null rather
 * than dropped by JSON.stringify.
 */
interface SyncedState {
  htmlByType: Partial<Record<SalesPageHtmlType, string>>;
  htmlMode: "snapshot" | undefined;
  source: { url: string; importedAt: string } | undefined;
}

const syncedById = new Map<string, SyncedState>();

function rememberSynced(page: SalesPage): void {
  syncedById.set(page.id, {
    htmlByType: { ...page.htmlByType },
    htmlMode: page.htmlMode,
    source: page.source !== undefined ? { ...page.source } : undefined,
  });
}

const HTML_TYPE_SLOTS: SalesPageHtmlType[] = ["component", "code", "ai"];

/** The list table: summaries only — documents never ride the index. */
export async function loadSalesPages(): Promise<SalesPageSummary[]> {
  const { salesPages } = await api.salesPages();
  return salesPages;
}

/** Full editor document; null for 404 (session errors propagate). */
export async function getSalesPage(id: string): Promise<SalesPage | null> {
  try {
    const page = fromWire(await api.salesPage(id));
    rememberSynced(page);
    return page;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export interface CreateSalesPageInput {
  name: string;
  slug: string;
  /**
   * Optional products picked in the create dialog: they become the page's
   * checkout selection — what the Checkout tab and the checkout block sell —
   * and nothing more. The picker never writes markup.
   */
  products?: string[];
}

/** The public address of a page at the current origin — its canonical URL. */
function canonicalUrlFor(slug: string): string {
  return new URL(`/${slug}`, window.location.origin).href;
}

/**
 * The catalogue as the document builder needs it: the Checkout tab already
 * fetches every product for its picker, so it primes this cache; a save that
 * arrives without a prime (page reload, direct save) fetches once here. A
 * failed fetch (dead session) just omits products — the save still lands.
 */
let checkoutProducts: Product[] | null = null;

/** Prime the cache from a component that already holds the catalogue. */
export function primeCheckoutProducts(products: Product[]): void {
  checkoutProducts = products;
}

/** The catalogue for a page's checkout block, in listing order, active only. */
async function resolveCheckoutProducts(page: SalesPage): Promise<Product[]> {
  if (page.checkoutProducts.length === 0) return [];
  if (checkoutProducts === null) {
    try {
      checkoutProducts = (await api.products()).products;
    } catch (error) {
      console.error("salespage_checkout_products_failed", error);
      return [];
    }
  }
  const byId = new Map(checkoutProducts.map((product) => [product.id, product]));
  return page.checkoutProducts
    .map((id) => byId.get(id))
    .filter((product): product is Product => product !== undefined);
}

/**
 * The standalone document for `/<slug>`, rebuilt from the page on every
 * write. A document the API would reject (> 3 MB, i.e. an oversized import
 * wrapped in the shell) is dropped from the payload so the content edits
 * still save; the stored public page then keeps its previous document.
 */
async function documentFor(page: SalesPage): Promise<string> {
  const document = buildSalesPageDocument(page, {
    canonicalUrl: canonicalUrlFor(page.slug),
    checkoutProducts: await resolveCheckoutProducts(page),
  });
  if (new TextEncoder().encode(document).length > SALESPAGE_HTML_MAX_BYTES) {
    console.error("salespage_document_too_large", page.id);
    return "";
  }
  return document;
}

/**
 * Creates the page server-side: a blank Import Editor document (no sections,
 * no markup — every byte arrives through the Import tab or Code view), with
 * the picked products as its checkout selection. The public `/<slug>`
 * document ships with the create, so the address works before the first
 * edit. A taken slug surfaces as an ApiError(409, "slug_taken") for the
 * dialog to show inline — the URL is never silently suffixed.
 */
export async function createSalesPage(input: CreateSalesPageInput): Promise<SalesPage> {
  // What the server would seed the row with — good enough to render the
  // initial public document (empty sections, titles pre-filled with the name).
  const draft: SalesPage = {
    id: "",
    name: input.name,
    slug: input.slug,
    status: "open",
    visits: 0,
    seo: { title: input.name, description: "", keywords: "" },
    og: { title: input.name, description: "", image: "" },
    sections: [],
    style: defaultStyle(),
    checkoutProducts: input.products ?? [],
    paymentGateway: null,
    emailSender: null,
    trackings: [],
    htmlByType: {},
    createdAt: nowStamp(),
    updatedAt: nowStamp(),
  };
  const document = await documentFor(draft);
  const page = fromWire(
    await api.createSalesPage({
      name: input.name,
      slug: input.slug,
      ...(input.products !== undefined ? { products: input.products } : {}),
      ...(document !== "" ? { document } : {}),
    }),
  );
  rememberSynced(page);
  return page;
}

/**
 * PATCHes serialize through one queue: overlapping debounced saves (a slow
 * request racing the next edit) keep their call order, so the last write is
 * always the latest document.
 */
let saveQueue: Promise<unknown> = Promise.resolve();

export function saveSalesPage(page: SalesPage): Promise<SalesPage> {
  const run = saveQueue.then(() => performSave(page));
  saveQueue = run.catch(() => undefined);
  return run;
}

async function performSave(page: SalesPage): Promise<SalesPage> {
  const before = syncedById.get(page.id);

  // Document slots: string writes the R2 file, null deletes it, and an
  // unchanged slot isn't sent at all (nothing to write, nothing to clobber).
  const html: Partial<Record<SalesPageHtmlType, string | null>> = {};
  for (const slot of HTML_TYPE_SLOTS) {
    const current = page.htmlByType[slot] ?? null;
    if (current !== (before?.htmlByType[slot] ?? null)) html[slot] = current;
  }

  // The public `/<slug>` document rides every save: it is rebuilt from this
  // exact page state, so what the Worker serves is never staler than the last
  // edit. It is never diffed — cheap, and a rebuild can't miss a field.
  const document = await documentFor(page);

  // The two opaque fields cross the same impedance point: the SPA types them
  // richly, the API validates them as plain JSON records (zod server-side).
  const input: UpdateSalesPageInput = {
    name: page.name,
    slug: page.slug,
    status: page.status,
    seo: page.seo,
    og: page.og,
    sections: page.sections as unknown as UpdateSalesPageInput["sections"],
    style: page.style as unknown as UpdateSalesPageInput["style"],
    checkoutProducts: page.checkoutProducts,
    paymentGateway: page.paymentGateway,
    emailSender: page.emailSender,
    trackings: page.trackings,
    htmlType: page.htmlType,
    ...(document !== "" ? { document } : {}),
    ...(Object.keys(html).length > 0 ? { html } : {}),
    // Snapshot provenance: explicit nulls clear it (Reset), silence keeps it.
    ...(page.htmlMode !== before?.htmlMode ? { htmlMode: page.htmlMode ?? null } : {}),
    ...(JSON.stringify(page.source ?? null) !== JSON.stringify(before?.source ?? null)
      ? { source: page.source ?? null }
      : {}),
  };

  const saved = fromWire(await api.updateSalesPage(page.id, input));
  rememberSynced(page);
  return saved;
}

/** DELETEs the page (row first, documents after — the API cleans R2 up). */
export async function deleteSalesPage(id: string): Promise<void> {
  await api.deleteSalesPage(id);
  syncedById.delete(id);
}
