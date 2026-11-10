import { COUNTRIES } from "@storesy/shared";
import type { Product } from "@storesy/shared";
import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { api } from "../lib/api";
import { formatPrice, imageSrc } from "../lib/product";
import { FAKE_SHIPPING_CENTS } from "../lib/salesPages";
import type { PayButtonColors } from "../lib/salesPageDocument";

/** What the buyer is filling in — local to this view, never saved anywhere. */
interface CustomerDetails {
  name: string;
  phone: string;
  email: string;
  address: string;
  postcode: string;
  city: string;
  state: string;
  country: string;
}

const EMPTY_CUSTOMER: CustomerDetails = {
  name: "",
  phone: "",
  email: "",
  address: "",
  postcode: "",
  city: "",
  state: "",
  country: "",
};

/** Price the buyer pays — the sale price when a discount is running. */
function effectivePrice(product: Product): number {
  return product.discountPrice ?? product.price;
}

interface Props {
  /**
   * The page's picked product ids (Checkout tab → Select Product), listing
   * order — the block sells exactly these, not the whole catalogue. Ids that
   * no longer resolve to an active product are skipped.
   */
  productIds: string[];
  /**
   * The page's own primary button colours (imported pages), detected exactly
   * like the saved document does. Null/absent → the app accent (the block's
   * own default) styles the pay button.
   */
  payColors?: PayButtonColors | null;
}

/**
 * The page's bottom-most block, toggled from the Checkout tab ("Show Checkout"
 * / "No Checkout"). It sells the products picked for the page: a product
 * listing, a cart (add / quantity / remove / faked shipping), then customer
 * details — with the address fields only when something in the cart ships.
 * The pay button is visual only for now. Cart and form state stay local to
 * the rendered view, like a real buyer's browser session.
 */
export function SalesCheckout({ productIds, payColors }: Props) {
  // null = still loading; the store's active products back the listing.
  const [products, setProducts] = useState<Product[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Product id → quantity in the cart.
  const [cart, setCart] = useState<Record<string, number>>({});
  const [customer, setCustomer] = useState<CustomerDetails>(EMPTY_CUSTOMER);

  useEffect(() => {
    let alive = true;
    api
      .products()
      .then((response) => {
        // Drafts never show in a customer-facing listing.
        if (alive) setProducts(response.products.filter((product) => product.status === "active"));
      })
      .catch(() => {
        // Signed-out visitors can't read the catalogue — render it empty.
        if (alive) {
          setProducts([]);
          setFailed(true);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  /** The page's own listing — the picked ids that resolve to active products. */
  const listed =
    products === null
      ? null
      : productIds
          .map((id) => products.find((product) => product.id === id))
          .filter((product): product is Product => product !== undefined);
  // A first visit starts with the first listed product, quantity 1 — the
  // live block's default, mirrored so the preview reads like the real page.
  useEffect(() => {
    if (products === null || products.length === 0) return;
    const first = productIds
      .map((id) => products.find((product) => product.id === id))
      .find((product) => product !== undefined);
    if (!first) return;
    setCart((prev) => (Object.keys(prev).length > 0 ? prev : { [first.id]: 1 }));
  }, [products, productIds]);

  /** Cart lines in listing order, resolved against the page's listing. */
  const lines = (listed ?? [])
    .map((product) => ({ product, qty: cart[product.id] ?? 0 }))
    .filter((line) => line.qty > 0);
  const needsShipment = lines.some((line) => line.product.fulfilment.shipment);
  const subtotal = lines.reduce((sum, line) => sum + effectivePrice(line.product) * line.qty, 0);
  // Faked flat rate: one shipping line whenever anything in the cart ships.
  const shipping = needsShipment ? FAKE_SHIPPING_CENTS : 0;
  const total = subtotal + shipping;

  const add = (id: string) => setCart((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
  const bump = (id: string, delta: number) =>
    setCart((prev) => ({ ...prev, [id]: Math.max(1, (prev[id] ?? 1) + delta) }));
  const remove = (id: string) =>
    setCart((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  const field = (key: keyof CustomerDetails) => ({
    value: customer[key],
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setCustomer((prev) => ({ ...prev, [key]: event.target.value })),
  });

  /** Product thumbnail; without a featured image the gradient placeholder shows. */
  const thumb = (product: Product, className: string) => (
    <span className={className}>
      {product.featured ? <img src={imageSrc(product.featured)} alt="" loading="lazy" /> : null}
    </span>
  );

  return (
    <section className="sco">
      <div className="ssv__wrap">
        <h3 className="ssv__title sco__title">Checkout</h3>

        {/* Product listing — the products picked for this page. */}
        {listed === null ? (
          <p className="sco__note">Loading products…</p>
        ) : listed.length === 0 ? (
          <p className="sco__note">
            {failed
              ? "Sign in to load your products."
              : "Nothing for sale on this page yet."}
          </p>
        ) : (
          <div className="sco__grid">
            {listed.map((product) => (
              <article key={product.id} className="sco__card">
                {thumb(product, "sco__thumb")}
                <div className="sco__cardBody">
                  <span className="sco__name">{product.name}</span>
                  <span className="sco__price">
                    <span className="sco__priceNow">{formatPrice(effectivePrice(product))}</span>
                    {product.discountPrice !== null ? (
                      <s className="sco__priceWas">{formatPrice(product.price)}</s>
                    ) : null}
                  </span>
                </div>
                <button type="button" className="sco__add" onClick={() => add(product.id)}>
                  Add product
                </button>
              </article>
            ))}
          </div>
        )}

        {/* Cart — quantity steppers, remove, running total. */}
        <h4 className="sco__h4">Cart</h4>
        {lines.length === 0 ? (
          <p className="sco__note">Your cart is empty — add a product above.</p>
        ) : (
          <div className="sco__cart">
            {lines.map(({ product, qty }) => (
              <div key={product.id} className="sco__row">
                {thumb(product, "sco__rowThumb")}
                <span className="sco__rowName">{product.name}</span>
                <span className="sco__rowUnit">{formatPrice(effectivePrice(product))}</span>
                <span className="sco__qty">
                  <button
                    type="button"
                    className="sco__step"
                    aria-label={`Decrease quantity of ${product.name}`}
                    disabled={qty <= 1}
                    onClick={() => bump(product.id, -1)}
                  >
                    −
                  </button>
                  <span className="sco__qtyNum">{qty}</span>
                  <button
                    type="button"
                    className="sco__step"
                    aria-label={`Increase quantity of ${product.name}`}
                    onClick={() => bump(product.id, 1)}
                  >
                    +
                  </button>
                </span>
                <span className="sco__rowLine">{formatPrice(effectivePrice(product) * qty)}</span>
                <button
                  type="button"
                  className="sco__remove"
                  aria-label={`Remove ${product.name} from cart`}
                  onClick={() => remove(product.id)}
                >
                  ✕
                </button>
              </div>
            ))}
            {/* Shipping — faked flat rate, only when something in the cart ships. */}
            {shipping > 0 ? (
              <div className="sco__ship">
                <span>Shipping</span>
                <span className="sco__shipNum">{formatPrice(shipping)}</span>
              </div>
            ) : null}
            <div className="sco__total">
              <span>Total</span>
              <span className="sco__totalNum">{formatPrice(total)}</span>
            </div>
          </div>
        )}

        {/* Customer details — address fields appear only when something ships. */}
        <h4 className="sco__h4">Customer details</h4>
        <div className="sco__fields">
          <label className="sco__field">
            <span>Name</span>
            <input type="text" placeholder="Jane Doe" {...field("name")} />
          </label>
          <label className="sco__field">
            <span>Phone</span>
            <input type="tel" placeholder="012 345 6789" {...field("phone")} />
          </label>
          <label className="sco__field sco__field--wide">
            <span>Email</span>
            <input type="email" placeholder="jane@example.com" {...field("email")} />
          </label>
          {needsShipment ? (
            <>
              <label className="sco__field sco__field--wide">
                <span>Address</span>
                <input type="text" placeholder="Street address" {...field("address")} />
              </label>
              <label className="sco__field">
                <span>Postcode</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="50000"
                  {...field("postcode")}
                />
              </label>
              <label className="sco__field">
                <span>City</span>
                <input type="text" placeholder="Kuala Lumpur" {...field("city")} />
              </label>
              <label className="sco__field sco__field--wide">
                <span>State</span>
                <input type="text" placeholder="Selangor" {...field("state")} />
              </label>
              <label className="sco__field sco__field--wide">
                <span>Country</span>
                <select {...field("country")}>
                  <option value="">Choose a country…</option>
                  {COUNTRIES.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
        </div>

        {/* Visual only for now — the payment step comes next. */}
        <button
          type="button"
          className="sco__pay"
          style={
            payColors
              ? { background: payColors.background, color: payColors.color }
              : undefined
          }
        >
          Proceed to Payment
        </button>
      </div>
    </section>
  );
}
