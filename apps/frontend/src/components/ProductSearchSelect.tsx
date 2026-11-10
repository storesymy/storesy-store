import type { Product } from "@storesy/shared";
import { Icon } from "@storesy/ui";
import { useEffect, useRef, useState } from "react";
import { formatPrice, imageSrc } from "../lib/product";

interface Props {
  /** The catalogue, newest first — null while the fetch is in flight. */
  products: Product[] | null;
  /** Products already picked, in pick order — each removable on its own. */
  values: Product[];
  /** The pick set changed: a product was added, or a picked row's × fired. */
  onChange: (products: Product[]) => void;
}

/** The default view: the newest products, capped at a glanceable six. */
const LATEST_LIMIT = 6;

/**
 * Optional product search-select for the create-sales-page dialog — a
 * multi-pick: type to filter by name or code (PRD-0001), click to add, and
 * the list stays open so several can go in one after another. Picks stack
 * underneath as removable rows, and already-picked products leave the list
 * (with an "everything's on the page" note when none remain). Drafts show
 * but aren't pickable, mirroring the Add Product dialog in the editor's
 * Checkout tab. Leaving it empty still creates the page — placeholder art
 * and an empty checkout.
 */
export function ProductSearchSelect({ products, values, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Click-away closes the list — armed on mouseup, not mousedown. The list
  // drops inline, so collapsing it between a button's press and its release
  // yanks that button out from under the pointer: mouseup then hits the
  // backdrop instead and the click never reaches the button (Create Now did
  // nothing with the dropdown open). mouseup still fires before the row's
  // click, so picking a product keeps the list open.
  useEffect(() => {
    if (!open) return;
    function onUp(event: globalThis.MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [open]);

  const all = products ?? [];
  const pickedIds = new Set(values.map((value) => value.id));
  const needle = query.trim().toLowerCase();
  const unpicked = all.filter((product) => !pickedIds.has(product.id));
  // The list arrives newest first — no search simply shows its head.
  const shown =
    needle === ""
      ? unpicked.slice(0, LATEST_LIMIT)
      : unpicked.filter(
          (product) =>
            product.name.toLowerCase().includes(needle) ||
            product.code.toLowerCase().includes(needle),
        );

  // Click-add keeps the list up — adding several in a row is the point —
  // and hands focus back to the input so the next search starts at once.
  function add(product: Product): void {
    onChange([...values, product]);
    setQuery("");
    inputRef.current?.focus();
  }

  return (
    <div className="pss" ref={rootRef}>
      <label className="pss__label" htmlFor="sp-product">
        Product (optional)
      </label>
      <div className="pss__field">
        <Icon name="search" size={14} className="pss__searchIcon" />
        <input
          id="sp-product"
          ref={inputRef}
          className="pss__input"
          type="text"
          autoComplete="off"
          placeholder="Search products by name or code…"
          value={query}
          onFocus={() => setOpen(true)}
          // A click re-opens too — after Escape the input keeps focus, and a
          // focused input fires no second focus event, so the click is what
          // brings the list back for mouse users.
          onClick={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              if (open) {
                event.preventDefault();
                setOpen(false);
              }
              return;
            }
            // Enter takes the top match and closes — "done searching"; the
            // list closed, the next Enter submits the create form.
            if (event.key === "Enter" && open) {
              event.preventDefault();
              const first = shown.find((product) => product.status === "active");
              if (first) {
                onChange([...values, first]);
                setQuery("");
              }
              setOpen(false);
            }
          }}
        />
      </div>
      {open ? (
        <ul className="pss__list" aria-label="Products">
          {products === null ? (
            <li className="pss__empty">Loading products…</li>
          ) : all.length === 0 ? (
            <li className="pss__empty">No products yet — add one under Products first.</li>
          ) : shown.length === 0 ? (
            <li className="pss__empty">
              {needle === ""
                ? "Every product is already on the page."
                : <>No products match “{query.trim()}”.</>}
            </li>
          ) : (
            shown.map((product) => {
              const draft = product.status !== "active";
              return (
                <li key={product.id}>
                  <button
                    type="button"
                    className="pss__row"
                    disabled={draft}
                    title={draft ? "Drafts can't be sold — activate it in Products." : undefined}
                    onClick={() => add(product)}
                  >
                    <span className="pss__thumb">
                      {product.featured ? (
                        <img src={imageSrc(product.featured)} alt="" loading="lazy" />
                      ) : null}
                    </span>
                    <span className="pss__info">
                      <span className="pss__name">{product.name}</span>
                      <span className="pss__code">{product.code}</span>
                    </span>
                    {draft ? (
                      <span className="pss__draft">Draft</span>
                    ) : (
                      <span className="pss__price">
                        {formatPrice(product.discountPrice ?? product.price)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
      {values.length > 0 ? (
        <ul className="pss__pickedList" aria-label="Picked products">
          {values.map((product) => (
            <li key={product.id} className="pss__picked">
              <span className="pss__thumb">
                {product.featured ? <img src={imageSrc(product.featured)} alt="" /> : null}
              </span>
              <span className="pss__info">
                <span className="pss__name">{product.name}</span>
                <span className="pss__code">{product.code}</span>
              </span>
              <span className="pss__price">
                {formatPrice(product.discountPrice ?? product.price)}
              </span>
              <button
                type="button"
                className="pss__clear"
                aria-label={`Remove ${product.name}`}
                onClick={() => onChange(values.filter((value) => value.id !== product.id))}
              >
                <Icon name="close" size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="pss__hint">Optional — the picked products become the page’s checkout selection.</p>
    </div>
  );
}
