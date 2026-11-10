import { Button, Icon, Pager, Shell, TextField } from "@storesy/ui";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import type { Product } from "@storesy/shared";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { buildNav, SYSTEM_MENU } from "../lib/nav";
import { formatPrice, imageSrc } from "../lib/product";
import { useTheme } from "../lib/theme";

/** Shared Product plus the purely-visual new-row flag. */
type ProductRow = Product & {
  /** Just created — flashes the row on mount. */
  isNew?: boolean;
};

const TYPE_OPTIONS: Array<{ value: "physical" | "digital"; label: string }> = [
  { value: "physical", label: "Physical" },
  { value: "digital", label: "Digital" },
];

const PAGE_SIZE = 8;

/** `2 hours ago` from a `YYYY-MM-DD HH:MM:SS` Asia/Kuala_Lumpur wall-clock. */
function relativeTime(stored: string): string {
  const then = Date.parse(`${stored.replace(" ", "T")}+08:00`);
  if (!Number.isFinite(then)) return stored;
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}

export function ProductsPage() {
  const { user, loading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", type: "physical" as "physical" | "digital" });
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [createError, setCreateError] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingProducts(true);
    setLoadError(undefined);
    api
      .products()
      .then(({ products: rows }) => {
        if (!cancelled) setProducts(rows);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // Session died mid-tab: bounce to login like a signed-out user.
        if (error instanceof ApiError && error.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setLoadError(error instanceof Error ? error.message : "Could not load products.");
      })
      .finally(() => {
        if (!cancelled) setLoadingProducts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, reloadKey]);

  useEffect(() => {
    if (!createOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setCreateOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [createOpen]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return products;
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(needle) ||
        product.code.toLowerCase().includes(needle),
    );
  }, [products, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const rows = filtered.slice(startIndex, startIndex + PAGE_SIZE);
  const from = filtered.length === 0 ? 0 : startIndex + 1;
  const to = Math.min(startIndex + PAGE_SIZE, filtered.length);
  const activeCount = products.filter((product) => product.status === "active").length;

  if (loading || loadingProducts) {
    return (
      <div className="page-loading" role="status">
        Loading…
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  function handleSearch(value: string) {
    setQuery(value);
    setPage(1);
  }

  function openCreate() {
    setForm({ name: "", type: "physical" });
    setNameError(undefined);
    setCreateError(undefined);
    setCreateOpen(true);
  }

  /** Real create: the returned row (prd-… uuid, PRD-… code) joins the list. */
  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setNameError("Give the product a name.");
      return;
    }
    setCreating(true);
    setCreateError(undefined);
    try {
      const created = await api.createProduct({ name, type: form.type });
      setProducts((prev) => [{ ...created, isNew: true }, ...prev]);
      setQuery("");
      setPage(1);
      setCreateOpen(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        navigate("/login", { replace: true });
        return;
      }
      if (error instanceof ApiError && error.fields?.name) {
        setNameError(error.fields.name);
        return;
      }
      setCreateError(
        error instanceof ApiError ? error.message : "Could not create the product. Try again.",
      );
    } finally {
      setCreating(false);
    }
  }

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
      menuLinks={user.role === "owner" ? SYSTEM_MENU : undefined}
    >
      <div className="pd">
        <header className="pd__header">
          <div>
            <h1 className="pd__title">Products</h1>
            <p className="pd__sub">
              {products.length} {products.length === 1 ? "product" : "products"} · {activeCount}{" "}
              active
            </p>
          </div>
          <Button onClick={openCreate}>Create New</Button>
        </header>

        <div className="pd__toolbar">
          <label className="pd__search">
            <Icon name="search" size={15} className="pd__searchIcon" />
            <input
              className="pd__searchInput"
              type="search"
              placeholder="Search name or ID…"
              aria-label="Search products"
              value={query}
              onChange={(event) => handleSearch(event.target.value)}
            />
          </label>
          <span className="pd__resultCount">
            {filtered.length === products.length
              ? `${products.length} total`
              : `${filtered.length} of ${products.length}`}
          </span>
        </div>

        <div className="pd__panel">
          {loadError ? (
            <div className="pd__empty">
              <Icon name="bag" size={22} className="pd__emptyIcon" />
              <p className="pd__emptyTitle">Could not load products</p>
              <p className="pd__emptyHint">{loadError}</p>
              <button
                type="button"
                className="pd__clear"
                onClick={() => setReloadKey((key) => key + 1)}
              >
                Try again
              </button>
            </div>
          ) : products.length === 0 ? (
            <div className="pd__empty">
              <Icon name="bag" size={22} className="pd__emptyIcon" />
              <p className="pd__emptyTitle">No products yet</p>
              <p className="pd__emptyHint">Create your first product to see it here.</p>
              <Button onClick={openCreate}>Create your first product</Button>
            </div>
          ) : (
            <table className="pd__table" aria-label="Products">
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col" className="pd__num">
                    Price
                  </th>
                  <th scope="col" className="pd__num">
                    Inventory
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">Updated</th>
                  <th scope="col" className="pd__action">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((product) => (
                  <tr
                    key={product.id}
                    className={product.isNew ? "pd__row pd__row--new" : "pd__row"}
                  >
                    <td>
                      <div className="pd__product">
                        {product.featured ? (
                          <img
                            className="pd__thumb pd__thumb--img"
                            src={imageSrc(product.featured)}
                            alt=""
                          />
                        ) : (
                          <span className="pd__thumb" aria-hidden="true">
                            <Icon name="image" size={16} />
                          </span>
                        )}
                        <span className="pd__productText">
                          <span className="pd__name">{product.name}</span>
                          <span className="pd__code">{product.code}</span>
                        </span>
                      </div>
                    </td>
                    <td className="pd__num pd__price">{formatPrice(product.price)}</td>
                    <td className="pd__num">
                      {product.stock === 0 ? (
                        <span className="pd__stock pd__stock--out">Out of stock</span>
                      ) : product.stock <= 5 ? (
                        <span className="pd__stock pd__stock--low">{product.stock} left</span>
                      ) : (
                        <span className="pd__stock">{product.stock} in stock</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={
                          product.status === "active" ? "pd__pill pd__pill--live" : "pd__pill"
                        }
                      >
                        {product.status === "active" ? "Active" : "Draft"}
                      </span>
                    </td>
                    <td className="pd__updated">{relativeTime(product.updatedAt)}</td>
                    <td className="pd__action">
                      <Button
                        variant="secondary"
                        onClick={() => navigate(`/product/${product.id}`)}
                      >
                        Manage
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {loadError === undefined && products.length > 0 && rows.length === 0 ? (
            <div className="pd__empty">
              <Icon name="bag" size={22} className="pd__emptyIcon" />
              <p className="pd__emptyTitle">No products match “{query}”</p>
              <p className="pd__emptyHint">Try a different name or ID.</p>
              <button type="button" className="pd__clear" onClick={() => handleSearch("")}>
                Clear search
              </button>
            </div>
          ) : null}
        </div>

        <Pager
          page={currentPage}
          pageCount={pageCount}
          from={from}
          to={to}
          total={filtered.length}
          onPageChange={setPage}
          label="Products pages"
        />
      </div>

      {createOpen ? (
        <div className="pd-modal" role="presentation" onClick={() => setCreateOpen(false)}>
          <div
            className="pd-modal__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pd-create-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="pd-modal__head">
              <h2 id="pd-create-title">Create product</h2>
              <button
                type="button"
                className="pd-modal__close"
                aria-label="Close"
                onClick={() => setCreateOpen(false)}
              >
                <Icon name="close" size={15} />
              </button>
            </header>

            <form className="pd-modal__body" onSubmit={handleCreate} noValidate>
              <TextField
                label="Product name"
                name="pd-name"
                value={form.name}
                onValueChange={(value) => {
                  setForm((prev) => ({ ...prev, name: value }));
                  if (nameError) setNameError(undefined);
                }}
                placeholder="e.g. Aurora Desk Lamp"
                error={nameError}
                autoFocus
              />
              <div className="pd__field">
                <span>Product Type</span>
                <div className="pd__typeGroup" role="radiogroup" aria-label="Product Type">
                  {TYPE_OPTIONS.map((option) => {
                    const selected = form.type === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={
                          selected ? "pd__typeOption pd__typeOption--active" : "pd__typeOption"
                        }
                        onClick={() => setForm((prev) => ({ ...prev, type: option.value }))}
                      >
                        <span
                          className={selected ? "pd__typeDot pd__typeDot--on" : "pd__typeDot"}
                          aria-hidden="true"
                        >
                          {selected ? <Icon name="check" size={11} /> : null}
                        </span>
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {createError ? (
                <p className="pd-modal__error" role="alert">
                  {createError}
                </p>
              ) : null}
              <div className="pd-modal__actions">
                <Button
                  variant="secondary"
                  onClick={() => setCreateOpen(false)}
                  disabled={creating}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={creating}>
                  Create product
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}
