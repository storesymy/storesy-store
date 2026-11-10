import type { Customer, CustomerPage } from "@storesy/shared";
import { Button, Icon, Pager, Shell } from "@storesy/ui";
import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { buildNav } from "../lib/nav";
import { formatPrice } from "../lib/product";
import { relativeTime } from "../lib/salesPages";
import { useTheme } from "../lib/theme";

/** 30 per page, per the customers screen's spec. */
const PER_PAGE = 30;
/** Typing settles before the server is asked — one request per pause. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Customers — buyers captured by the checkout, one row per email. Search runs
 * on the server (name or email) with 30 per page, so the list stays fast as
 * the store grows. Read-only: the checkout is what writes these rows.
 */
export function CustomersPage() {
  const { user, loading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  // Default view: newest customer first. No and LTV are sortable.
  const [sort, setSort] = useState<"no" | "ltv">("no");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [data, setData] = useState<CustomerPage | null>(null);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);

  // Debounced search: the query settles, then the list jumps back to page 1.
  useEffect(() => {
    const next = query.trim();
    const timer = setTimeout(() => {
      setSearch(next);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoadingCustomers(true);
    setLoadError(undefined);
    api
      .customers({ q: search, page, perPage: PER_PAGE, sort, dir })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // Session died mid-tab: bounce to login like a signed-out user.
        if (error instanceof ApiError && error.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setLoadError(error instanceof ApiError ? error.message : "Could not load customers.");
      })
      .finally(() => {
        if (!cancelled) setLoadingCustomers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [search, page, sort, dir, reloadKey, navigate]);

  /** Click a sortable header: same column flips direction, a new one starts desc. */
  function toggleSort(column: "no" | "ltv") {
    if (sort === column) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setSort(column);
      setDir("desc");
    }
    setPage(1);
  }

  /** ▲/▼ for the active column, a muted ↕ for the other. */
  function sortMark(column: "no" | "ltv"): string {
    if (sort !== column) return "↕";
    return dir === "asc" ? "▲" : "▼";
  }

  function ariaSort(column: "no" | "ltv"): "ascending" | "descending" | "none" {
    if (sort !== column) return "none";
    return dir === "asc" ? "ascending" : "descending";
  }

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

  const customers = data?.customers ?? [];
  const total = data?.total ?? 0;
  // The API clamps a page past the end; trust its answer for the pager.
  const currentPage = data?.page ?? page;
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const from = total === 0 ? 0 : (currentPage - 1) * PER_PAGE + 1;
  const to = Math.min(currentPage * PER_PAGE, total);

  return (
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
      <div className="pd">
        <header className="pd__header">
          <div>
            <h1 className="pd__title">Customers</h1>
            <p className="pd__sub">
              {loadingCustomers
                ? "Loading customers…"
                : `${total} ${total === 1 ? "customer" : "customers"}`}
            </p>
          </div>
          <Button variant="secondary" onClick={() => setReloadKey((key) => key + 1)}>
            Refresh
          </Button>
        </header>

        <div className="pd__toolbar">
          <label className="pd__search">
            <Icon name="search" size={15} className="pd__searchIcon" />
            <input
              className="pd__searchInput"
              type="search"
              placeholder="Search name, email or phone…"
              aria-label="Search customers"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <span className="pd__resultCount">
            {loadingCustomers
              ? "Searching…"
              : search
                ? `${total} ${total === 1 ? "match" : "matches"}`
                : `${total} total`}
          </span>
        </div>

        <div className="pd__panel">
          {loadError ? (
            <div className="pd__empty">
              <Icon name="customers" size={22} className="pd__emptyIcon" />
              <p className="pd__emptyTitle">Could not load customers</p>
              <p className="pd__emptyHint">{loadError}</p>
              <button
                type="button"
                className="pd__clear"
                onClick={() => setReloadKey((key) => key + 1)}
              >
                Try again
              </button>
            </div>
          ) : !loadingCustomers && total === 0 && search === "" ? (
            <div className="pd__empty">
              <Icon name="customers" size={22} className="pd__emptyIcon" />
              <p className="pd__emptyTitle">No customers yet</p>
              <p className="pd__emptyHint">
                Buyers appear here automatically after their first checkout.
              </p>
            </div>
          ) : !loadingCustomers && total === 0 ? (
            <div className="pd__empty">
              <Icon name="search" size={22} className="pd__emptyIcon" />
              <p className="pd__emptyTitle">No customers match “{search}”</p>
              <p className="pd__emptyHint">Try a different name or email.</p>
              <button type="button" className="pd__clear" onClick={() => setQuery("")}>
                Clear search
              </button>
            </div>
          ) : (
            <table className="pd__table" aria-label="Customers">
              <thead>
                <tr>
                  <th scope="col" className="pd__noWrap" aria-sort={ariaSort("no")}>
                    <button type="button" className="pd__sort" onClick={() => toggleSort("no")}>
                      NO
                      <span className="pd__sortMark" aria-hidden="true">
                        {sortMark("no")}
                      </span>
                    </button>
                  </th>
                  <th scope="col">Customer</th>
                  <th scope="col" className="pd__num">
                    Contacts
                  </th>
                  <th scope="col">Country</th>
                  <th scope="col" className="pd__num" aria-sort={ariaSort("ltv")}>
                    <button type="button" className="pd__sort" onClick={() => toggleSort("ltv")}>
                      LTV
                      <span className="pd__sortMark" aria-hidden="true">
                        {sortMark("ltv")}
                      </span>
                    </button>
                  </th>
                  <th scope="col" className="pd__noWrap">
                    Last checkout
                  </th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr className="pd__row" key={customer.id}>
                    <td>
                      <Link className="pd__code pd__link" to={`/customer/${customer.id}`}>
                        {customer.customerNo}
                      </Link>
                    </td>
                    <td>
                      <span className="pd__name">{customer.name}</span>
                      {customer.badge ? (
                        <span className={`pd__pill pd__pill--${customer.badge}`}>
                          {customer.badge}
                        </span>
                      ) : null}
                      <br />
                      <span className="pd__code">{customer.email}</span>
                    </td>
                    <td className="pd__num">{customer.contacts}</td>
                    <td className="pd__updated">
                      {customer.countryName ?? customer.countryCode ?? "—"}
                    </td>
                    <td className="pd__num">{formatPrice(customer.ltvCents)}</td>
                    <td className="pd__updated">
                      {customer.lastCheckoutDate ? relativeTime(customer.lastCheckoutDate) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {total > 0 ? (
          <Pager
            page={currentPage}
            pageCount={pageCount}
            from={from}
            to={to}
            total={total}
            onPageChange={setPage}
            label="Customers pages"
          />
        ) : null}
      </div>
    </Shell>
  );
}
