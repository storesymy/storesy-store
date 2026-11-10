import type { Store, StoreCode, StoreComingSoon, StoreLink, StoreType } from "@storesy/shared";
import { useCallback, useEffect, useState } from "react";
import {
  clearPublishedSnapshot,
  readPublishedSnapshot,
  writePublishedSnapshot,
} from "./publishedStore";

const STORAGE_KEY = "storesy.storefront.v1";

export type CodeFile = keyof StoreCode;

export interface CreateStoreInput {
  type: StoreType;
  name: string;
  tagline: string;
  handle: string;
}

/** Seeded Custom HTML template so the editor is never blank. */
const DEFAULT_CODE: StoreCode = {
  html: `<div class="hero">
  <p class="eyebrow">Acme Supplies</p>
  <h1>Things that last.</h1>
  <p class="sub">Gear built for the long haul — guaranteed for life.</p>
  <a class="cta" href="#features">Shop the collection</a>
</div>

<section class="features" id="features">
  <article>
    <h3>Free shipping</h3>
    <p>On every order over $50.</p>
  </article>
  <article>
    <h3>Life guarantee</h3>
    <p>If it breaks, we replace it.</p>
  </article>
  <article>
    <h3>Real support</h3>
    <p>Humans answer within a day.</p>
  </article>
</section>`,
  css: `* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #14181f;
  background: #ffffff;
}

.hero {
  padding: 56px 24px;
  text-align: center;
  background: #fff1e6;
}

.eyebrow {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #ff6500;
}

.hero h1 {
  margin: 0 0 10px;
  font-size: 34px;
}

.sub {
  margin: 0 auto 22px;
  max-width: 460px;
  color: #5a6472;
  line-height: 1.5;
}

.cta {
  display: inline-block;
  padding: 12px 22px;
  border-radius: 6px;
  background: #ff6500;
  color: #14181f;
  font-weight: 700;
  text-decoration: none;
}

.features {
  display: grid;
  gap: 16px;
  padding: 32px 24px;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.features article {
  padding: 18px;
  border: 1px solid #e3e7ee;
  border-radius: 8px;
}

.features h3 {
  margin: 0 0 6px;
  font-size: 16px;
}

.features p {
  margin: 0;
  color: #5a6472;
  font-size: 14px;
  line-height: 1.5;
}`,
  js: `// Runs live in the preview — try editing me.
const cta = document.querySelector(".cta");

cta?.addEventListener("click", (event) => {
  event.preventDefault();
  cta.textContent = "Added to cart ✓";
  cta.style.background = "#14181f";
  cta.style.color = "#ffffff";
});`,
};

/** Demo link targets point at the current origin — the store's URL in this phase. */
function demoLinks(): StoreLink[] {
  const origin = window.location.origin;
  return [
    { id: "link_1", label: "Shop all products", url: origin },
    { id: "link_2", label: "Read our story", url: `${origin}/pages/about` },
    { id: "link_3", label: "Follow us on Instagram", url: "https://instagram.com/acmesupplies" },
  ];
}

/** First-run demo store: shows the design immediately until a real API exists. */
const DEMO_STORE: Store = {
  id: "store_demo",
  name: "Acme Supplies",
  slug: "acme-supplies",
  tagline: "Things that last.",
  handle: "acmesupplies",
  // The default type, so a fresh browser lands on it.
  type: "coming-soon",
  status: "draft",
  currency: "USD",
  announcement: "Free shipping on orders over $50",
  links: demoLinks(),
  code: DEFAULT_CODE,
  comingSoon: { banner: "Coming Soon", marquee: "Acme Supplies" },
  createdAt: 0,
  updatedAt: 0,
};

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "my-store"
  );
}

function newId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replaceAll("-", "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${random}`;
}

function parseStore(raw: string | null): Store | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Store;
    if (parsed && typeof parsed.id === "string" && Array.isArray(parsed.links) && parsed.code) {
      // Payloads saved before the Coming Soon type existed lack its fields.
      const comingSoon: StoreComingSoon = parsed.comingSoon ?? {
        banner: "Coming Soon",
        marquee: parsed.name || "Coming Soon",
      };
      return { ...parsed, comingSoon };
    }
  } catch {
    // Corrupt payload — treat as "not configured".
  }
  return null;
}

/**
 * Load order for the editor: `?fresh=1` forces the create-flow empty state (for
 * review) and clears the published document too, then any saved store, then the
 * seeded demo store so the design is visible on first visit.
 */
function loadInitial(): Store | null {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has("fresh")) {
      window.localStorage.removeItem(STORAGE_KEY);
      clearPublishedSnapshot();
      return null;
    }
    const stored = parseStore(window.localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
  } catch {
    // Unavailable storage — fall through to the demo store.
  }
  const now = Date.now();
  return { ...DEMO_STORE, links: DEMO_STORE.links.map((link) => ({ ...link })), code: { ...DEFAULT_CODE }, createdAt: now, updatedAt: now };
}

/**
 * The single data seam for /storefront. Today it is seeded/local; the API phase
 * swaps these internals for GET/POST /api/stores without touching the page.
 */
export function useStorefront() {
  const [store, setStore] = useState<Store | null>(loadInitial);

  useEffect(() => {
    try {
      if (store) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Non-fatal: state simply won't persist.
    }
  }, [store]);

  // Stores already marked Live from before static publishing existed: freeze
  // them once so `/` keeps matching the Live status shown in the header.
  useEffect(() => {
    if (store?.status === "active" && !readPublishedSnapshot()) {
      writePublishedSnapshot(store);
    }
  }, [store]);

  const patch = useCallback((changes: Partial<Store>) => {
    setStore((current) => (current ? { ...current, ...changes, updatedAt: Date.now() } : current));
  }, []);

  function create(input: CreateStoreInput): void {
    const now = Date.now();
    setStore({
      id: newId("store"),
      name: input.name,
      slug: slugify(input.name),
      tagline: input.tagline,
      handle: input.handle.trim() || slugify(input.name).replace(/-/g, ""),
      type: input.type,
      status: "draft",
      currency: "USD",
      announcement: "Free shipping on orders over $50",
      links: [],
      code: { ...DEFAULT_CODE },
      comingSoon: { banner: "Coming Soon", marquee: input.name },
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Publish freezes the storefront into the static document `/` serves. */
  function publish(): void {
    if (store) writePublishedSnapshot(store);
    patch({ status: "active" });
  }

  /** Unpublish deletes the static document — `/` falls back to Coming Soon. */
  function unpublish(): void {
    clearPublishedSnapshot();
    patch({ status: "draft" });
  }

  /**
   * Type switching is non-destructive: links/code stay on the store and merely hide.
   * Returns a message for the toast when saved content is being hidden.
   */
  function setType(next: StoreType): string | null {
    if (!store || store.type === next) return null;
    let message: string | null = null;
    if (store.type === "link-tree" && store.links.length > 0) {
      const count = store.links.length;
      message = `Your ${count} link${count === 1 ? "" : "s"} stay saved but hidden.`;
    } else if (store.type === "custom-html") {
      message = "Your custom code stays saved but hidden.";
    }
    patch({ type: next });
    return message;
  }

  function addLink(): void {
    if (!store) return;
    const link: StoreLink = {
      id: newId("link"),
      label: `Link ${store.links.length + 1}`,
      url: "",
    };
    patch({ links: [...store.links, link] });
  }

  function updateLink(id: string, changes: Partial<StoreLink>): void {
    if (!store) return;
    patch({ links: store.links.map((link) => (link.id === id ? { ...link, ...changes } : link)) });
  }

  function removeLink(id: string): void {
    if (!store) return;
    patch({ links: store.links.filter((link) => link.id !== id) });
  }

  function moveLink(id: string, direction: -1 | 1): void {
    if (!store) return;
    const index = store.links.findIndex((link) => link.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= store.links.length) return;
    const links = [...store.links];
    const [moved] = links.splice(index, 1);
    if (!moved) return;
    links.splice(target, 0, moved);
    patch({ links });
  }

  function setCode(file: CodeFile, value: string): void {
    if (!store) return;
    patch({ code: { ...store.code, [file]: value } });
  }

  function resetCode(): void {
    patch({ code: { ...DEFAULT_CODE } });
  }

  function setComingSoon(changes: Partial<StoreComingSoon>): void {
    if (!store) return;
    patch({ comingSoon: { ...store.comingSoon, ...changes } });
  }

  return {
    store,
    create,
    publish,
    unpublish,
    setType,
    addLink,
    updateLink,
    removeLink,
    moveLink,
    setCode,
    resetCode,
    setComingSoon,
  };
}
