import type { CustomerContact, CustomerDetail } from "@storesy/shared";
import { countryByCode } from "@storesy/shared";
import { Icon, Shell } from "@storesy/ui";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fullTime } from "../lib/datetime";
import { buildNav } from "../lib/nav";
import { formatPrice } from "../lib/product";
import { useTheme } from "../lib/theme";

/** One shipping/contact profile as a card. */
function ContactCard({ contact }: { contact: CustomerContact }) {
  const country =
    contact.countryName ?? countryByCode(contact.countryCode)?.name ?? contact.countryCode ?? "";
  const lines = [
    contact.address,
    [contact.postcode, contact.city].filter(Boolean).join(" "),
    contact.state,
    country,
  ].filter((line): line is string => typeof line === "string" && line !== "");

  return (
    <section className="od__card">
      <header className="od__cardHead">
        <h2 className="od__cardTitle">{contact.name || "Unnamed contact"}</h2>
        {contact.phone ? <span className="od__muted">{contact.phone}</span> : null}
      </header>
      {lines.length > 0 ? (
        <address className="od__address">
          {lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </address>
      ) : (
        <p className="od__muted">No address on file.</p>
      )}
      <p className="od__muted">
        Added {fullTime(contact.createdAt)} · Updated {fullTime(contact.updatedAt)}
      </p>
    </section>
  );
}

/**
 * One customer: the identity at a glance (number, badge, email, LTV, paid
 * checkouts) and every active shipping/contact profile as its own card.
 * Mirrors the order detail page's 8/4 layout.
 */
export function CustomerDetailPage() {
  const { user, loading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const { uuid } = useParams();

  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [loadingCustomer, setLoadingCustomer] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!uuid) return;
    let cancelled = false;
    setLoadingCustomer(true);
    setLoadError(undefined);
    api
      .customer(uuid)
      .then((found) => {
        if (!cancelled) setDetail(found);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setLoadError(error instanceof ApiError ? error.message : "Could not load this customer.");
      })
      .finally(() => {
        if (!cancelled) setLoadingCustomer(false);
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

  if (loadingCustomer) {
    return shell(
      <div className="page-loading" role="status">
        Loading customer…
      </div>,
    );
  }

  if (!detail) {
    return shell(
      <div className="pd">
        <div className="od__head">
          <Link to="/customers" className="od__back" aria-label="Back to customers">
            <Icon name="arrowLeft" size={16} />
          </Link>
          <div>
            <h1 className="od__title">Customer</h1>
            <p className="od__meta">{loadError ?? "This customer doesn’t exist."}</p>
          </div>
        </div>
        <button type="button" className="pd__clear" onClick={() => setReloadKey((key) => key + 1)}>
          Try again
        </button>
      </div>,
    );
  }

  const { customer, contacts } = detail;
  const country = customer.countryName ?? countryByCode(customer.countryCode)?.name ?? "";

  return shell(
    <div className="pd od">
      <header className="od__head">
        <Link to="/customers" className="od__back" aria-label="Back to customers">
          <Icon name="arrowLeft" size={16} />
        </Link>
        <div>
          <div className="od__titleRow">
            <h1 className="od__title">{customer.customerNo}</h1>
            {customer.badge ? (
              <span className={`pd__pill pd__pill--${customer.badge}`}>{customer.badge}</span>
            ) : null}
          </div>
          <p className="od__meta">
            {contacts.length} {contacts.length === 1 ? "contact profile" : "contact profiles"} · customer since{" "}
            {fullTime(customer.createdAt)}
          </p>
        </div>
      </header>

      <div className="od__grid">
        <div className="od__main">
          <div className="od__sectionHead">
            <h2 className="od__cardTitle">Contact details</h2>
            <span className="od__muted">{contacts.length}</span>
          </div>
          {contacts.length === 0 ? (
            <section className="od__card">
              <p className="od__muted">No contact details yet — they arrive with the first checkout.</p>
            </section>
          ) : (
            contacts.map((contact) => <ContactCard key={contact.id} contact={contact} />)
          )}
        </div>

        <aside className="od__side">
          <section className="od__card">
            <h2 className="od__cardTitle">Customer</h2>
            <p className="od__name">{customer.name}</p>
            <span className="od__email">{customer.email}</span>
            <dl className="od__rows">
              <div className="od__row">
                <dt>Lifetime value</dt>
                <dd>{formatPrice(customer.ltvCents)}</dd>
              </div>
              <div className="od__row">
                <dt>Total checkouts</dt>
                <dd>{customer.totalCheckout}</dd>
              </div>
              <div className="od__row">
                <dt>Contact profiles</dt>
                <dd>{contacts.length}</dd>
              </div>
              {country ? (
                <div className="od__row">
                  <dt>Country</dt>
                  <dd>{country}</dd>
                </div>
              ) : null}
              <div className="od__row">
                <dt>Customer since</dt>
                <dd>{fullTime(customer.createdAt)}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </div>,
  );
}
