import type { Store, StoreType } from "@storesy/shared";
import { useEffect, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ComingSoonView,
  EcommerceView,
  LinkTreeView,
  SalesPageView,
} from "../components/StorePreview";
import { composeCodeDocument } from "./codeDocument";

const PUBLISHED_KEY = "storesy.storefront.published.v1";

/**
 * The static storefront document frozen at Publish time — this is what `/`
 * serves. Draft edits never touch it; only another Publish rewrites it.
 * (API phase: the write moves to POST /api/stores/:id/publish, the read to a
 * public GET /api/stores/:slug.)
 */
export interface PublishedSnapshot {
  /** Store type when published — decides how the static HTML is displayed. */
  type: StoreType;
  /** Static HTML: a full document for Custom HTML, a markup body otherwise. */
  html: string;
}

/** Freeze the storefront into static HTML — runs once, when Publish is clicked. */
export function buildPublishedSnapshot(store: Store): PublishedSnapshot {
  if (store.type === "custom-html") {
    return { type: store.type, html: composeCodeDocument(store.code) };
  }

  // The Link Tree keeps its full-bleed backdrop so the injected markup is
  // self-contained on the public route.
  const view =
    store.type === "coming-soon" ? (
      <ComingSoonView store={store} />
    ) : store.type === "sales-page" ? (
      <SalesPageView store={store} />
    ) : store.type === "link-tree" ? (
      <div className="pv__linkTree">
        <LinkTreeView store={store} />
      </div>
    ) : (
      <EcommerceView store={store} />
    );

  return { type: store.type, html: renderToStaticMarkup(view) };
}

export function writePublishedSnapshot(store: Store): void {
  try {
    window.localStorage.setItem(PUBLISHED_KEY, JSON.stringify(buildPublishedSnapshot(store)));
  } catch {
    // Non-fatal: `/` simply stays on Coming Soon.
  }
}

export function clearPublishedSnapshot(): void {
  try {
    window.localStorage.removeItem(PUBLISHED_KEY);
  } catch {
    // Non-fatal: storage already unavailable.
  }
}

export function readPublishedSnapshot(): PublishedSnapshot | null {
  try {
    const raw = window.localStorage.getItem(PUBLISHED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PublishedSnapshot;
    if (parsed && typeof parsed.html === "string" && typeof parsed.type === "string") {
      return parsed;
    }
  } catch {
    // Corrupt or unavailable — treat as unpublished.
  }
  return null;
}

/** The published document for public pages, refreshed across tabs. */
export function usePublishedSnapshot(): PublishedSnapshot | null {
  const [snapshot, setSnapshot] = useState<PublishedSnapshot | null>(() => {
    // `?fresh=1` previews the pre-launch screen without deleting the publish.
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("fresh")) {
      return null;
    }
    return readPublishedSnapshot();
  });

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      // `storage` fires in the *other* tabs: Publish/Unpublish in the editor
      // updates an already-open public tab immediately.
      if (event.key === PUBLISHED_KEY || event.key === null) {
        setSnapshot(readPublishedSnapshot());
      }
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return snapshot;
}
