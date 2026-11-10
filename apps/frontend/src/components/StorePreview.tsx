import { Icon } from "@storesy/ui";
import type { Store } from "@storesy/shared";
import type { ReactNode } from "react";
import { CopyUrlButton } from "./CopyUrlButton";

type Device = "desktop" | "mobile";

interface StorePreviewProps {
  store: Store;
  device: Device;
  onDeviceChange: (device: Device) => void;
}

function initial(store: Store): string {
  return store.name.trim().charAt(0).toUpperCase() || "S";
}

/** Shared customer-facing header for the page-based storefront types. */
function StorefrontHeader({ store }: { store: Store }) {
  return (
    <div className="sfv__nav">
      <span className="sfv__logo" aria-hidden="true">
        {initial(store)}
      </span>
      <span className="sfv__brand">{store.name}</span>
      <span className="sfv__navLinks" aria-hidden="true">
        <span>Shop</span>
        <span>About</span>
        <span>Contact</span>
      </span>
      <span className="sfv__bag">
        <Icon name="bag" size={17} />
      </span>
    </div>
  );
}

function BrowserFrame({
  url,
  device,
  onDeviceChange,
  children,
}: {
  url: string;
  device: Device;
  onDeviceChange: (device: Device) => void;
  children: ReactNode;
}) {
  const site = <div className="sf-frame__site">{children}</div>;

  return (
    <div className="sf-frame">
      <div className="sf-frame__chrome">
        <span className="sf-frame__dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <div className="sf-frame__url">
          <Icon name="lock" size={13} />
          {/* The chrome URL opens the storefront (this origin) in a new tab. */}
          <a className="sf-frame__urlText" href="/" target="_blank" rel="noreferrer">
            {url}
          </a>
          <CopyUrlButton url="/" />
        </div>
        <div className="sf-frame__tools">
          <span className="sf-frame__deviceGroup" role="group" aria-label="Preview size">
            <button
              type="button"
              className={device === "desktop" ? "sf-tool sf-tool--active" : "sf-tool"}
              aria-pressed={device === "desktop"}
              aria-label="Desktop preview"
              onClick={() => onDeviceChange("desktop")}
            >
              <Icon name="monitor" size={15} />
            </button>
            <button
              type="button"
              className={device === "mobile" ? "sf-tool sf-tool--active" : "sf-tool"}
              aria-pressed={device === "mobile"}
              aria-label="Mobile preview"
              onClick={() => onDeviceChange("mobile")}
            >
              <Icon name="phone" size={15} />
            </button>
          </span>
          <span className="sf-tool sf-tool--static" aria-hidden="true">
            <Icon name="refresh" size={15} />
          </span>
        </div>
      </div>

      <div
        className={
          device === "mobile" ? "sf-frame__stage sf-frame__stage--mobile" : "sf-frame__stage"
        }
      >
        {device === "mobile" ? <div className="sf-frame__device">{site}</div> : site}
      </div>
    </div>
  );
}

/**
 * Coming Soon type: nothing but a single headline dead-center of the screen —
 * no header, no footer. Reused by the public `/` route.
 */
export function ComingSoonView({ store }: { store: Store }) {
  const title = store.comingSoon.banner.trim() || "Coming Soon";

  return (
    <div className="soonC">
      <h1 className="soonC__title">{title}</h1>
    </div>
  );
}

/** Customer view for the eCommerce type — reused by the public `/` route. */
export function EcommerceView({ store }: { store: Store }) {
  return (
    <div className="sfv">
      {store.announcement ? <div className="sfv__announce">{store.announcement}</div> : null}
      <StorefrontHeader store={store} />

      <section className="sfv__hero">
        <h2 className="sfv__heroTitle">{store.name}</h2>
        <p className="sfv__heroSub">{store.tagline}</p>
        <span className="sfv__btn">Shop now</span>
      </section>

      <section className="sfv__section">
        <div className="sfv__sectionHead">
          <h3>New arrivals</h3>
          <span className="sfv__sectionLink">View all</span>
        </div>
        <div className="sfv__grid">
          <div className="sfv__empty">
            <Icon name="plus" size={20} className="sfv__emptyIcon" />
            <strong>No products yet</strong>
            <span>Add your first product and it will appear here.</span>
          </div>
        </div>
      </section>

      <footer className="sfv__footer">© {store.name} · Powered by Storesy</footer>
    </div>
  );
}

const BENEFITS: [string, string][] = [
  ["Built to last", "Materials we stand behind for life."],
  ["Ships free", "On every order over $50."],
  ["Try it for 30 days", "Full refund, no questions asked."],
];

/** Customer view for the Sales Page type — reused by the public `/` route. */
export function SalesPageView({ store }: { store: Store }) {
  return (
    <div className="sfv">
      {store.announcement ? <div className="sfv__announce">{store.announcement}</div> : null}
      <StorefrontHeader store={store} />

      <section className="sfv__spHero">
        <span className="sfv__chip">Limited release</span>
        <h2>{store.tagline || store.name}</h2>
        <p>
          One product, done properly. {store.name} is what you buy once instead of replacing every
          year.
        </p>
        <span className="sfv__btn sfv__btn--lg">Get it — $49</span>
      </section>

      <section className="sfv__benefits">
        {BENEFITS.map(([title, body]) => (
          <div className="sfv__benefit" key={title}>
            <span className="sfv__benefitDot" aria-hidden="true">
              <Icon name="check" size={14} />
            </span>
            <h4>{title}</h4>
            <p>{body}</p>
          </div>
        ))}
      </section>

      <blockquote className="sfv__quote">
        “Exactly what I needed — arrived in two days and feels indestructible.”
        <cite>Jordan M. · verified buyer</cite>
      </blockquote>

      <section className="sfv__buy">
        <div className="sfv__buyThumb" aria-hidden="true">
          <Icon name="bag" size={28} />
        </div>
        <div className="sfv__buyBody">
          <span className="sfv__chip">One-time purchase</span>
          <h3>{store.name} — lifetime pack</h3>
          <p className="sfv__price">
            $49 <s>$69</s>
          </p>
          <span className="sfv__btn sfv__btn--lg">Buy now</span>
          <small>Secure checkout · 30-day money-back guarantee</small>
        </div>
      </section>

      <footer className="sfv__footer">© {store.name} · Powered by Storesy</footer>
    </div>
  );
}

/** Customer view for the Link Tree type — reused by the public `/` route. */
export function LinkTreeView({ store }: { store: Store }) {
  return (
    <div className="sfl">
      <div className="sfl__avatar" aria-hidden="true">
        {initial(store)}
      </div>
      <p className="sfl__name">{store.name}</p>
      <p className="sfl__handle">@{store.handle}</p>

      <div className="sfl__links">
        {store.links.length === 0 ? (
          <div className="sfl__empty">
            No links yet — add your first one under <strong>Edit links</strong>.
          </div>
        ) : (
          store.links.map((link) => (
            <div className="sfl__link" key={link.id}>
              <span className="sfl__linkLabel">{link.label.trim() || "Untitled link"}</span>
              <Icon name="external" size={15} className="sfl__linkIcon" />
            </div>
          ))
        )}
      </div>

      <div className="sfl__socials" aria-hidden="true">
        <span>ig</span>
        <span>x</span>
        <span>yt</span>
      </div>
    </div>
  );
}

/** Renders the frame that matches the store's type; Custom HTML is handled by the CodeEditor. */
export function StorePreview({ store, device, onDeviceChange }: StorePreviewProps) {
  // The store is served from the current origin in this UI-only phase.
  const url = window.location.host;

  if (store.type === "link-tree") {
    return (
      <div className="sf-stage">
        <div className="sf-phone">
          <div className="sf-phone__screen">
            <LinkTreeView store={store} />
          </div>
        </div>
      </div>
    );
  }

  let view: ReactNode;
  if (store.type === "coming-soon") {
    view = <ComingSoonView store={store} />;
  } else if (store.type === "sales-page") {
    view = <SalesPageView store={store} />;
  } else {
    view = <EcommerceView store={store} />;
  }

  return (
    <BrowserFrame url={url} device={device} onDeviceChange={onDeviceChange}>
      {view}
    </BrowserFrame>
  );
}
