import type { Product } from "@storesy/shared";
import { Icon, TextField } from "@storesy/ui";
import { useEffect, useState } from "react";
import { formatPrice, imageSrc } from "../lib/product";

interface Props {
  /** The store's products, newest first — drafts show, but aren't addable. */
  products: Product[];
  /** Ids already on the page — offered as "Added", never twice. */
  selected: string[];
  /** A product row was clicked — the caller appends it to the selection. */
  onAdd: (product: Product) => void;
  onClose: () => void;
}

/** The default view: the newest products, capped at a glanceable six. */
const LATEST_LIMIT = 6;

/**
 * "Add Product" dialog for the Checkout tab — the newest products first,
 * a search field for the rest. Every product shows, so the catalogue is
 * never silently missing rows: drafts are tagged and disabled (a draft
 * isn't for sale — activate it in Products first), as are rows already on
 * the page ("Added"). Clicking an active row hands the product to the
 * caller, which appends it to the page's checkout list.
 */
export function AddProductModal({ products, selected, onAdd, onClose }: Props) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const needle = query.trim().toLowerCase();
  // The list arrives newest first — the default view is simply its head;
  // a search matches on name or product code (PRD-0001) with no cap.
  const shown =
    needle === ""
      ? products.slice(0, LATEST_LIMIT)
      : products.filter(
          (product) =>
            product.name.toLowerCase().includes(needle) ||
            product.code.toLowerCase().includes(needle),
        );

  return (
    <div
      className="pd-modal"
      role="presentation"
      onMouseDown={() => onClose()}
    >
      <div
        className="pd-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="apm-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="pd-modal__head">
          <h2 id="apm-title">Add Product</h2>
          <button
            type="button"
            className="pd-modal__close"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="close" size={15} />
          </button>
        </header>

        <div className="pd-modal__body">
          <TextField
            label="Search products"
            name="add-product-search"
            value={query}
            onValueChange={setQuery}
            placeholder="Name or code…"
            autoFocus
            autoComplete="off"
          />
          {products.length === 0 ? (
            <p className="apm__empty">No products yet — create one in Products.</p>
          ) : shown.length === 0 ? (
            <p className="apm__empty">No products match “{query.trim()}”.</p>
          ) : (
            <ul className="apm__list">
              {shown.map((product) => {
                // Drafts are the state needing attention — they win the tag
                // even when also on the page (the section lists those).
                const draft = product.status !== "active";
                const added = selected.includes(product.id);
                return (
                  <li key={product.id}>
                    <button
                      type="button"
                      className="apm__row"
                      disabled={added || draft}
                      onClick={() => onAdd(product)}
                    >
                      <span className="apm__thumb">
                        {product.featured ? (
                          <img src={imageSrc(product.featured)} alt="" loading="lazy" />
                        ) : null}
                      </span>
                      <span className="apm__info">
                        <span className="apm__name">{product.name}</span>
                        <span className="apm__code">{product.code}</span>
                      </span>
                      {draft ? (
                        <span className="apm__draft">Draft</span>
                      ) : added ? (
                        <span className="apm__added">Added</span>
                      ) : (
                        <span className="apm__price">
                          {formatPrice(product.discountPrice ?? product.price)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {shown.some((product) => product.status !== "active") ? (
            <p className="apm__note">
              Drafts can’t be added — activate them in Products to sell them.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
