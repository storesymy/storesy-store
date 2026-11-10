import type { Order, OrderFulfilmentStatus } from "@storesy/shared";
import { countryByCode, providerOf } from "@storesy/shared";
import { Icon, Shell } from "@storesy/ui";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fullTime } from "../lib/datetime";
import { buildNav } from "../lib/nav";
import { formatPrice, imageSrc } from "../lib/product";
import { useTheme } from "../lib/theme";

const FULFILMENT_LABEL: Record<OrderFulfilmentStatus, string> = {
  unfulfilled: "Unfulfilled",
  fulfilled: "Fulfilled",
  delivered: "Delivered",
};

const PAYMENT_LABEL: Record<string, string> = {
  paid: "Paid",
  pending: "Pending",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Semantic pill for the order's payment state. */
function paymentPill(status: string): string {
  return ["paid", "pending", "failed", "cancelled"].includes(status)
    ? `pd__pill pd__pill--${status}`
    : "pd__pill";
}

/**
 * One order: the merchant's full view. Eight columns carry the money and the
 * journey (fulfilment, payment, timeline); four carry the actions and the
 * people (action, customer, shipping).
 */
export function OrderDetailPage() {
  const { user, loading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const { uuid } = useParams();

  const [order, setOrder] = useState<Order | null>(null);
  const [loadingOrder, setLoadingOrder] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!uuid) return;
    let cancelled = false;
    setLoadingOrder(true);
    setLoadError(undefined);
    api
      .order(uuid)
      .then((found) => {
        if (!cancelled) setOrder(found);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setLoadError(error instanceof ApiError ? error.message : "Could not load this order.");
      })
      .finally(() => {
        if (!cancelled) setLoadingOrder(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uuid, navigate, reloadKey]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } finally {
      setLoggingOut(false);
    }
  }

  async function handleAction(value: string) {
    if (!order || value === "") return;
    setSaving(true);
    setActionError(undefined);
    try {
      setOrder(await api.updateOrderFulfilment(order.id, value as OrderFulfilmentStatus));
    } catch (error) {
      setActionError(
        error instanceof ApiError ? error.message : "Could not update the fulfilment status.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  const shell = (body: ReactNode) => (
    <Shell
      userName={user.name}
      userEmail={user.email}
      userRole={user.role}
      brandIcon="/storesy-icon.png"
      theme={theme}
      onThemeToggle={toggleTheme}
      onLogout={handleLogout}
      loggingOut={loggingOut}
      nav={buildNav(location.pathname, user.role)}
      onNavigate={(href) => navigate(href)}
    >
      {body}
    </Shell>
  );

  if (loadingOrder) {
    return shell(
      <div className="page-loading" role="status">
        Loading order…
      </div>,
    );
  }

  if (!order) {
    return shell(
      <div className="pd">
        <div className="od__head">
          <Link to="/orders" className="od__back" aria-label="Back to orders">
            <Icon name="arrowLeft" size={16} />
          </Link>
          <div>
            <h1 className="od__title">Order</h1>
            <p className="od__meta">{loadError ?? "This order doesn’t exist."}</p>
          </div>
        </div>
        <button type="button" className="pd__clear" onClick={() => setReloadKey((key) => key + 1)}>
          Try again
        </button>
      </div>,
    );
  }

  const countryName = countryByCode(order.customer.country)?.name ?? order.customer.country ?? "";
  const shippingLines = [
    order.customer.address,
    [order.customer.postcode, order.customer.city].filter(Boolean).join(" "),
    order.customer.state,
    countryName,
  ].filter((line): line is string => typeof line === "string" && line !== "");

  const digitalOnly = order.shippingCents === 0;
  const paymentLabel = PAYMENT_LABEL[order.status] ?? order.status;
  const fulfilmentLabel = FULFILMENT_LABEL[order.fulfilment.status];
  const fulfilmentPill = `pd__pill pd__pill--${order.fulfilment.status}`;

  const paymentNote =
    order.status === "pending"
      ? "Payment pending"
      : order.status === "failed"
        ? "Payment failed"
        : order.status === "cancelled"
          ? "Payment cancelled"
          : "Payment received";

  const timeline = [
    { label: "Visit sales page", at: order.events.visitedAt },
    { label: "Added to cart", at: order.events.addedAt },
    { label: "Checkout", at: order.createdAt },
    { label: paymentNote, at: order.paidAt },
    { label: "Fulfilment", at: order.fulfilment.fulfilledAt },
    { label: "Delivered", at: order.fulfilment.deliveredAt },
  ];

  return shell(
    <div className="pd od">
      <header className="od__head">
        <Link to="/orders" className="od__back" aria-label="Back to orders">
          <Icon name="arrowLeft" size={16} />
        </Link>
        <div>
          <div className="od__titleRow">
            <h1 className="od__title">{order.orderNo}</h1>
            {order.test ? <span className="pd__pill pd__pill--test">test</span> : null}
            <span className={paymentPill(order.status)}>{paymentLabel}</span>
            <span className={fulfilmentPill}>{fulfilmentLabel}</span>
          </div>
          <p className="od__meta">
            {fullTime(order.createdAt)} from{" "}
            <a
              className="od__link"
              href={`/${order.page.slug}`}
              target="_blank"
              rel="noreferrer"
            >
              /{order.page.slug}
            </a>
          </p>
        </div>
      </header>

      <div className="od__grid">
        <div className="od__main">
          <section className="od__card">
            <header className="od__cardHead">
              <h2 className="od__cardTitle">Fulfilment</h2>
              <span className={fulfilmentPill}>{fulfilmentLabel}</span>
            </header>
            <ul className="od__items">
              {order.items.map((item, index) => (
                <li className="od__item" key={`${item.product}-${index}`}>
                  <span className="od__itemThumb" aria-hidden="true">
                    {item.image ? <img src={imageSrc(item.image)} alt="" loading="lazy" /> : null}
                  </span>
                  <span className="od__itemName">{item.name}</span>
                  <span className="od__itemMeta">
                    {formatPrice(item.unitCents)} × {item.qty}
                  </span>
                  <span className="od__itemLine">
                    {formatPrice(item.unitCents * item.qty)}
                  </span>
                </li>
              ))}
            </ul>
            <dl className="od__rows">
              <div className="od__row">
                <dt>Method</dt>
                <dd>
                  {order.shippingCents > 0
                    ? `Shipping · ${formatPrice(order.shippingCents)}`
                    : "Digital delivery"}
                </dd>
              </div>
              <div className="od__row">
                <dt>Fulfilled</dt>
                <dd>{fullTime(order.fulfilment.fulfilledAt)}</dd>
              </div>
              <div className="od__row">
                <dt>Delivered</dt>
                <dd>{fullTime(order.fulfilment.deliveredAt)}</dd>
              </div>
            </dl>
          </section>

          <section className="od__card">
            <header className="od__cardHead">
              <h2 className="od__cardTitle">Payment</h2>
              <span className={paymentPill(order.status)}>{paymentLabel}</span>
            </header>
            <dl className="od__rows">
              <div className="od__row">
                <dt>Method</dt>
                <dd>
                  {order.test
                    ? "Admin test checkout"
                    : order.payment
                      ? (providerOf(order.payment.provider)?.label ?? order.payment.provider)
                      : "—"}
                </dd>
              </div>
              {order.payment?.reference ? (
                <div className="od__row">
                  <dt>Reference</dt>
                  <dd className="od__mono">{order.payment.reference}</dd>
                </div>
              ) : null}
              <div className="od__row">
                <dt>Paid</dt>
                <dd>{fullTime(order.paidAt)}</dd>
              </div>
              <div className="od__row">
                <dt>Subtotal</dt>
                <dd>{formatPrice(order.subtotalCents)}</dd>
              </div>
              <div className="od__row">
                <dt>Shipping</dt>
                <dd>{formatPrice(order.shippingCents)}</dd>
              </div>
              <div className="od__row od__row--total">
                <dt>Total paid</dt>
                <dd>{formatPrice(order.totalCents)}</dd>
              </div>
            </dl>
            {order.payment?.url && !order.test ? (
              <a
                className="od__link"
                href={order.payment.url}
                target="_blank"
                rel="noreferrer"
              >
                Open in gateway ↗
              </a>
            ) : null}
            {order.test ? (
              <p className="od__note">Test checkout — no payment was taken.</p>
            ) : null}
          </section>

          <section className="od__card">
            <h2 className="od__cardTitle">Timeline</h2>
            <ol className="od__timeline">
              {timeline.map((event) => (
                <li
                  key={event.label}
                  className={event.at ? "od__event" : "od__event od__event--pending"}
                >
                  <span className="od__eventDot" aria-hidden="true" />
                  <span className="od__eventLabel">{event.label}</span>
                  <span className="od__eventAt">{event.at ? fullTime(event.at) : "—"}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="od__side">
          <section className="od__card">
            <h2 className="od__cardTitle">Action</h2>
            <select
              className="sf-select od__select"
              aria-label="Order action"
              value=""
              disabled={saving}
              onChange={(event) => handleAction(event.target.value)}
            >
              <option value="">{saving ? "Saving…" : "More actions…"}</option>
              {order.fulfilment.status === "unfulfilled" ? (
                <option value="fulfilled">Mark as fulfilled</option>
              ) : null}
              {order.fulfilment.status !== "delivered" ? (
                <option value="delivered">Mark as delivered</option>
              ) : null}
              {order.fulfilment.status !== "unfulfilled" && !digitalOnly ? (
                <option value="unfulfilled">Reset to unfulfilled</option>
              ) : null}
            </select>
            {digitalOnly ? (
              <p className="od__note">Digital order — fulfilled automatically.</p>
            ) : null}
            {actionError ? <p className="od__error">{actionError}</p> : null}
          </section>

          <section className="od__card">
            <h2 className="od__cardTitle">Customer</h2>
            {order.customerNo ? (
              <p className="od__muted">
                Customer No{" "}
                {order.customerId ? (
                  <Link className="od__link" to={`/customer/${order.customerId}`}>
                    {order.customerNo}
                  </Link>
                ) : (
                  <span className="od__mono">{order.customerNo}</span>
                )}
              </p>
            ) : null}
            <p className="od__name">{order.customer.name}</p>
            <p className="od__muted">
              {order.customerOrders} {order.customerOrders === 1 ? "order" : "orders"} · LTV{" "}
              {formatPrice(order.customerLtvCents)}
            </p>
            <span className="od__email">{order.customer.email}</span>
            <p className="od__muted">{order.customer.phone || "—"}</p>
          </section>

          <section className="od__card">
            <h2 className="od__cardTitle">Shipping details</h2>
            {shippingLines.length > 0 ? (
              <address className="od__address">
                <span className="od__name">{order.customer.name}</span>
                {shippingLines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
                {order.customer.phone ? <span>{order.customer.phone}</span> : null}
              </address>
            ) : (
              <p className="od__muted">Digital order — no shipping address.</p>
            )}
          </section>
        </aside>
      </div>
    </div>,
  );
}
