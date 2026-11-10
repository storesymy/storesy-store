import type { StoreType } from "@storesy/shared";
import type { IconName } from "@storesy/ui";

export interface StoreTypeOption {
  id: StoreType;
  icon: IconName;
  label: string;
  /** Short line used by the type tabs. */
  description: string;
  /** "Best for" line used by the create-flow cards. */
  bestFor: string;
}

/** Single source for the storefront types: create flow + preview tabs. */
export const STORE_TYPES: StoreTypeOption[] = [
  {
    id: "coming-soon",
    icon: "clock",
    label: "Coming Soon",
    description: "A teaser page: banner headline and a scrolling name marquee.",
    bestFor: "Building hype before launch",
  },
  {
    id: "ecommerce",
    icon: "cart",
    label: "eCommerce",
    description: "Browse products, add to cart and checkout.",
    bestFor: "Catalogs with multiple products",
  },
  {
    id: "sales-page",
    icon: "sales",
    label: "Sales Page",
    description: "One long sales page, with or without checkout at the bottom.",
    bestFor: "Selling a single product or offer",
  },
  {
    id: "link-tree",
    icon: "link",
    label: "Link Tree",
    description: "A list of links, Link-in-Bio style.",
    bestFor: "Creators and social bios",
  },
  {
    id: "custom-html",
    icon: "code",
    label: "Custom HTML",
    description: "Write your own HTML, CSS and JS.",
    bestFor: "Full creative control",
  },
];

export function storeTypeOption(type: StoreType): StoreTypeOption {
  const found = STORE_TYPES.find((option) => option.id === type);
  if (!found) throw new Error(`Unknown storefront type: ${type}`);
  return found;
}
