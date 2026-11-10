import { providerOf } from "@storesy/shared";
import type { IntegrationRecord, Product } from "@storesy/shared";
import { Icon } from "@storesy/ui";
import { useEffect, useState } from "react";
import { AddProductModal } from "./AddProductModal";
import { AddTrackingModal } from "./AddTrackingModal";
import { api } from "../lib/api";
import { formatPrice, imageSrc } from "../lib/product";
import { FAKE_SHIPPING_CENTS, primeCheckoutProducts } from "../lib/salesPages";
import type { CheckoutMode, SalesPageStyle } from "../lib/salesPages";

interface Props {
  style: SalesPageStyle;
  onPatch: (patch: Partial<SalesPageStyle>) => void;
  /** The page's selected product ids, listing order — what the block sells. */
  selected: string[];
  /** Selection changed: an added id is appended, a removed one dropped. */
  onSelect: (ids: string[]) => void;
  /** The checkout's chosen payment-gateway integration (`itg_…`), or none. */
  paymentGateway: string | null;
  /** Gateway selection changed; `null` clears it. */
  onGateway: (uuid: string | null) => void;
  /** The checkout's email sender (an Email-category integration), or none. */
  emailSender: string | null;
  /** Email-sender selection changed; `null` clears it. */
  onEmailSender: (uuid: string | null) => void;
  /** Tracking integrations this page reports to, in add order. */
  trackings: string[];
  /** The tracking list changed (add or remove). */
  onTrackings: (uuids: string[]) => void;
}

/** Sale price when a discount is running — the same rule the block uses. */
function effectivePrice(product: Product): number {
  return product.discountPrice ?? product.price;
}

/**
 * The editor's Checkout tab — the Show / No Checkout toggle, the Select
 * Product section (the page's checkout list, plus an Add Product dialog
 * that offers the newest products and a search), and a read-out of the
 * fake flat rate its cart charges for shipping (real rates come later).
 */
export function SalesCheckoutPanel({
  style,
  onPatch,
  selected,
  onSelect,
  paymentGateway,
  onGateway,
  emailSender,
  onEmailSender,
  trackings,
  onTrackings,
}: Props) {
  // The section and the dialog read the same catalogue the Products page
  // lists — every product, newest first (API order), so nothing is silently
  // missing. Drafts aren't for sale: the dialog tags them, and the block
  // below the canvas only ever sells the active ones.
  const [products, setProducts] = useState<Product[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [integrationRows, setIntegrationRows] = useState<IntegrationRecord[] | null>(null);
  const [trackingOpen, setTrackingOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .products()
      .then((response) => {
        // The document builder reads this cache on save — one fetch serves
        // the picker here and the `/<slug>` checkout block there.
        primeCheckoutProducts(response.products);
        if (alive) setProducts(response.products);
      })
      .catch(() => {
        if (alive) setProducts([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // All three option lists (Payment / Email / Tracking) ARE integration rows
  // the merchant connected under /integrations. Admin-only endpoint — a 403
  // (a non-admin somehow here) reads as "no rows", the API still gates.
  useEffect(() => {
    let alive = true;
    api
      .integrations()
      .then((response) => {
        if (alive) setIntegrationRows(response.integrations);
      })
      .catch(() => {
        if (alive) setIntegrationRows([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** Stored instances per category — what each select offers. */
  const rowsOfCategory = (category: string): IntegrationRecord[] =>
    (integrationRows ?? []).filter((row) => providerOf(row.provider)?.category === category);
  const paymentRows = rowsOfCategory("Payment");
  const emailRows = rowsOfCategory("Email");
  const trackingRows = rowsOfCategory("Tracking");
  /** A saved uuid whose row was deleted since — keep the select truthful. */
  const staleGateway = paymentGateway !== null && !paymentRows.some((row) => row.uuid === paymentGateway);
  const staleSender = emailSender !== null && !emailRows.some((row) => row.uuid === emailSender);
  /** Trackings already on the page, resolved (stale ids drop out of display). */
  const pickedTrackings = trackings
    .map((id) => (integrationRows ?? []).find((row) => row.uuid === id))
    .filter((row): row is IntegrationRecord => row !== undefined);
  /** What Add Tracking still offers: rows yet to be added AND from a brand
   *  not already on the page — multiple trackings allowed, one per brand. */
  const trackingsAvailable = trackingRows.filter(
    (row) =>
      !trackings.includes(row.uuid) &&
      !pickedTrackings.some((picked) => picked.provider === row.provider),
  );

  /** The selection resolved to products, in listing order (stale ids skip). */
  const picked =
    products === null
      ? null
      : selected
          .map((id) => products.find((product) => product.id === id))
          .filter((product): product is Product => product !== undefined);
  /** How many picked products the customer-facing block will actually sell. */
  const sellable = (picked ?? []).filter((product) => product.status === "active").length;

  /** Take a product back out of the page's checkout list. */
  function remove(id: string) {
    onSelect(selected.filter((entry) => entry !== id));
  }

  /** Add a chosen tracking (the modal only offers ones not yet added). */
  function addTracking(uuid: string) {
    if (!trackings.includes(uuid)) onTrackings([...trackings, uuid]);
    setTrackingOpen(false);
  }

  /** Take a tracking back off the page. */
  function removeTracking(uuid: string) {
    onTrackings(trackings.filter((id) => id !== uuid));
  }

  return (
    <div className="sp__panel" role="tabpanel" aria-label="Checkout">
      <div className="sp__group">
        <span className="sp__groupTitle">Checkout section</span>
        <div className="sp__sliderRow">
          <span className="sp__colorLabel">Bottom section</span>
        </div>
        <div className="sp__segRow">
          {(["show", "none"] as CheckoutMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={
                style.checkout === mode ? "sp__segBtn sp__segBtn--active" : "sp__segBtn"
              }
              aria-pressed={style.checkout === mode}
              onClick={() => onPatch({ checkout: mode })}
            >
              {mode === "show" ? "Show Checkout" : "No Checkout"}
            </button>
          ))}
        </div>
        <p className="sp__note">
          Pinned under your sections: product listing, cart, customer details and the pay button.
        </p>
      </div>

      <div className="sp__group">
        <span className="sp__groupTitle">Select Product</span>
        {products === null ? (
          <p className="sp__note">Loading products…</p>
        ) : products.length === 0 ? (
          <p className="sp__note">No products yet — create one in Products.</p>
        ) : (
          <>
            {picked !== null && picked.length > 0 ? (
              <ul className="sp__pick">
                {picked.map((product) => (
                  <li key={product.id} className="sp__pickRow sp__pickRow--on">
                    <span className="sp__pickThumb">
                      {product.featured ? (
                        <img src={imageSrc(product.featured)} alt="" loading="lazy" />
                      ) : null}
                    </span>
                    <span className="sp__pickName">{product.name}</span>
                    <span className="sp__pickPrice">{formatPrice(effectivePrice(product))}</span>
                    <button
                      type="button"
                      className="sp__pickBtn sp__pickBtn--on"
                      onClick={() => remove(product.id)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <button type="button" className="sp__addBtn" onClick={() => setPickerOpen(true)}>
              <Icon name="plus" size={13} />
              Add Product
            </button>
          </>
        )}
        <p className="sp__note">
          {selected.length === 0
            ? "Nothing selected — the checkout block sells no products."
            : `${sellable} product${sellable === 1 ? "" : "s"} sell${sellable === 1 ? "s" : ""} on this page.`}
        </p>
      </div>

      {pickerOpen ? (
        <AddProductModal
          products={products ?? []}
          selected={selected}
          onAdd={(product) => {
            // The dialog greys out added rows — this is belt-and-braces.
            if (!selected.includes(product.id)) onSelect([...selected, product.id]);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}

      <div className="sp__group">
        <span className="sp__groupTitle">Payment Gateway</span>
        {integrationRows === null ? (
          <p className="sp__note">Loading integrations…</p>
        ) : paymentRows.length === 0 ? (
          <p className="sp__note">
            No payment gateway connected yet — connect CHIP or Billplz under Integrations.
          </p>
        ) : (
          <>
            <select
              className="sf-select"
              aria-label="Payment Gateway"
              value={paymentGateway ?? ""}
              onChange={(event) => onGateway(event.target.value === "" ? null : event.target.value)}
            >
              <option value="">None — this page charges through no gateway yet</option>
              {staleGateway && paymentGateway ? (
                <option value={paymentGateway}>Saved gateway (row no longer exists)</option>
              ) : null}
              {paymentRows.map((row) => (
                <option key={row.uuid} value={row.uuid}>
                  {row.name} · {providerOf(row.provider)?.label ?? row.provider}
                </option>
              ))}
            </select>
            <p className="sp__note">
              {staleGateway
                ? "The saved gateway was deleted — pick a current one to replace it."
                : "Pulled from your connected payment integrations."}
            </p>
          </>
        )}
      </div>

      <div className="sp__group">
        <span className="sp__groupTitle">Email Sender</span>
        {integrationRows === null ? (
          <p className="sp__note">Loading integrations…</p>
        ) : emailRows.length === 0 ? (
          <p className="sp__note">
            No email sender connected yet — connect Gmail or Cloudflare Email under Integrations.
          </p>
        ) : (
          <>
            <select
              className="sf-select"
              aria-label="Email Sender"
              value={emailSender ?? ""}
              onChange={(event) => onEmailSender(event.target.value === "" ? null : event.target.value)}
            >
              <option value="">None — this page sends no email yet</option>
              {staleSender && emailSender ? (
                <option value={emailSender}>Saved sender (row no longer exists)</option>
              ) : null}
              {emailRows.map((row) => (
                <option key={row.uuid} value={row.uuid}>
                  {row.name} · {providerOf(row.provider)?.label ?? row.provider}
                </option>
              ))}
            </select>
            <p className="sp__note">
              {staleSender
                ? "The saved sender was deleted — pick a current one to replace it."
                : "Pulled from your connected email integrations."}
            </p>
          </>
        )}
      </div>

      <div className="sp__group">
        <span className="sp__groupTitle">Tracking</span>
        {integrationRows === null ? (
          <p className="sp__note">Loading integrations…</p>
        ) : trackingRows.length === 0 ? (
          <p className="sp__note">
            No tracking integration yet — connect Google Tag Manager, Meta Pixel or Tiktok
            Pixel under Integrations.
          </p>
        ) : (
          <>
            {pickedTrackings.length > 0 ? (
              <ul className="sp__pick">
                {pickedTrackings.map((row) => (
                  <li
                    key={row.uuid}
                    className="sp__pickRow sp__pickRow--on sp__pickRow--plain"
                  >
                    <span className="sp__pickName">
                      {row.name} · {providerOf(row.provider)?.label ?? row.provider}
                    </span>
                    <button
                      type="button"
                      className="sp__pickBtn"
                      onClick={() => removeTracking(row.uuid)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <button
              type="button"
              className="sp__addBtn"
              disabled={trackingsAvailable.length === 0}
              onClick={() => setTrackingOpen(true)}
            >
              <Icon name="plus" size={13} />
              Add Tracking
            </button>
            <p className="sp__note">
              {pickedTrackings.length === 0
                ? "Nothing added yet — choose a connected tracking integration."
                : `${pickedTrackings.length} tracking integration${pickedTrackings.length === 1 ? "" : "s"} on this page.`}
            </p>
          </>
        )}
      </div>

      {trackingOpen ? (
        <AddTrackingModal
          options={trackingsAvailable}
          onAdd={addTracking}
          onClose={() => setTrackingOpen(false)}
        />
      ) : null}

      <div className="sp__group">
        <span className="sp__groupTitle">Shipping</span>
        <p className="sp__note">
          {formatPrice(FAKE_SHIPPING_CENTS)} flat, added once when the cart holds an item that
          needs shipment. Faked for now — real rates come later.
        </p>
      </div>
    </div>
  );
}
