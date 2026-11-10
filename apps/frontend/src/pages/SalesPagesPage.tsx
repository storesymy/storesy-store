import type { Product } from "@storesy/shared";
import { Button, Icon, Pager, Shell, TextField } from "@storesy/ui";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ProductSearchSelect } from "../components/ProductSearchSelect";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { buildNav, SYSTEM_MENU } from "../lib/nav";
import {
  createSalesPage,
  isValidSlug,
  loadSalesPages,
  relativeTime,
  slugify,
} from "../lib/salesPages";
import type { SalesPageSummary } from "../lib/salesPages";
import { useTheme } from "../lib/theme";

const PAGE_SIZE = 8;

export function SalesPagesPage() {
  const { user, loading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const [pages, setPages] = useState<SalesPageSummary[]>([]);
  const [loadingPages, setLoadingPages] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "" });
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [slugError, setSlugError] = useState<string | undefined>(undefined);
  const [createError, setCreateError] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  // Once the user types their own slug, the auto-derivation steps aside.
  const [slugTouched, setSlugTouched] = useState(false);

  // The optional starter products for the create dialog: the catalogue loads
  // when the dialog opens, and the search-select hands back the pick set
  // (in pick order — the checkout sells them in it).
  const [products, setProducts] = useState<Product[] | null>(null);
  const [picked, setPicked] = useState<Product[]>([]);

  useEffect(() => {
    if (!createOpen) return;
    let alive = true;
    setProducts(null);
    api
      .products()
      .then((result) => {
        if (alive) setProducts(result.products);
      })
      .catch(() => {
        if (alive) setProducts([]);
      });
    return () => {
      alive = false;
    };
  }, [createOpen]);

  // The list loads from the API (summaries only — documents stay in R2).
  useEffect(() => {
    let cancelled = false;
    setLoadingPages(true);
    setLoadError(undefined);
    loadSalesPages()
      .then((rows) => {
        if (!cancelled) setPages(rows);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // Session died mid-tab: bounce to login like a signed-out user.
        if (error instanceof ApiError && error.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setLoadError(error instanceof Error ? error.message : "Could not load sales pages.");
      })
      .finally(() => {
        if (!cancelled) setLoadingPages(false);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, reloadKey]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return pages;
    return pages.filter(
      (entry) =>
        entry.name.toLowerCase().includes(needle) || entry.slug.toLowerCase().includes(needle),
    );
  }, [pages, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const rows = filtered.slice(startIndex, startIndex + PAGE_SIZE);
  const from = filtered.length === 0 ? 0 : startIndex + 1;
  const to = Math.min(startIndex + PAGE_SIZE, filtered.length);
  const openCount = pages.filter((entry) => entry.status === "open").length;

  if (loading || loadingPages) {
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
    setForm({ name: "", slug: "" });
    setNameError(undefined);
    setSlugError(undefined);
    setCreateError(undefined);
    setSlugTouched(false);
    setPicked([]);
    setCreateOpen(true);
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const name = form.name.trim();
    const rawSlug = form.slug.trim();
    let invalid = false;

    if (!name) {
      setNameError("Enter a name for the sales page.");
      invalid = true;
    }
    if (rawSlug && !isValidSlug(rawSlug)) {
      setSlugError("Use lowercase letters, numbers and dashes.");
      invalid = true;
    }
    if (invalid) return;

    // Blank slug derives from the name (falls back for non-latin names). The
    // server owns the URL: a slug that's taken comes back 409 and shows under
    // the field — never a silent -2 suffix. Picked products ride along as the
    // page's checkout selection only: the new page opens blank in the Import
    // Editor, with no markup written for it.
    const slug = rawSlug || slugify(name) || "sales-page";
    setCreating(true);
    setCreateError(undefined);
    try {
      const created = await createSalesPage({
        name,
        slug,
        products: picked.map((entry) => entry.id),
      });
      // The list keeps summaries: project the created page down to its row.
      const row: SalesPageSummary = {
        id: created.id,
        name: created.name,
        slug: created.slug,
        status: created.status,
        visits: created.visits,
        htmlType: created.htmlType ?? "code",
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      };
      setPages((prev) => [row, ...prev]);
      setCreateOpen(false);
      navigate(`/salespages/${created.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        navigate("/login", { replace: true });
        return;
      }
      if (error instanceof ApiError && (error.code === "slug_taken" || error.fields?.slug)) {
        setSlugError(error.fields?.slug ?? error.message);
        return;
      }
      if (error instanceof ApiError && error.fields?.name) {
        setNameError(error.fields.name);
        return;
      }
      setCreateError(
        error instanceof ApiError ? error.message : "Could not create the sales page. Try again.",
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
            <h1 className="pd__title">Sales Pages</h1>
            <p className="pd__sub">
              {pages.length} {pages.length === 1 ? "sales page" : "sales pages"} · {openCount} open
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
              placeholder="Search name or URL…"
              aria-label="Search sales pages"
              value={query}
              onChange={(event) => handleSearch(event.target.value)}
            />
          </label>
          <span className="pd__resultCount">
            {filtered.length === pages.length
              ? `${pages.length} total`
              : `${filtered.length} of ${pages.length}`}
          </span>
        </div>

        <div className="pd__panel">
          {loadError ? (
            <div className="pd__empty">
              <Icon name="layout" size={22} className="pd__emptyIcon" />
              <p className="pd__emptyTitle">Could not load sales pages</p>
              <p className="pd__emptyHint">{loadError}</p>
              <button
                type="button"
                className="pd__clear"
                onClick={() => setReloadKey((key) => key + 1)}
              >
                Try again
              </button>
            </div>
          ) : pages.length === 0 ? (
            <div className="pd__empty">
              <Icon name="layout" size={22} className="pd__emptyIcon" />
              <p className="pd__emptyTitle">No sales pages yet</p>
              <p className="pd__emptyHint">Create your first sales page to see it here.</p>
              <Button onClick={openCreate}>Create your first sales page</Button>
            </div>
          ) : (
            <table className="pd__table" aria-label="Sales Pages">
              <thead>
                <tr>
                  <th scope="col">Page</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="pd__num">
                    Visits
                  </th>
                  <th scope="col">Updated</th>
                  <th scope="col" className="pd__action">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr className="pd__row" key={entry.id}>
                    <td>
                      <div className="pd__product">
                        <span className="pd__thumb" aria-hidden="true">
                          <Icon name="layout" size={16} />
                        </span>
                        <span className="pd__productText">
                          <span className="pd__name">{entry.name}</span>
                          <span className="pd__code">/{entry.slug}</span>
                        </span>
                      </div>
                    </td>
                    <td>
                      <span
                        className={entry.status === "open" ? "pd__pill pd__pill--live" : "pd__pill"}
                      >
                        {entry.status === "open" ? "Open" : "Closed"}
                      </span>
                    </td>
                    <td className="pd__num">{entry.visits.toLocaleString("en-MY")}</td>
                    <td className="pd__updated">{relativeTime(entry.updatedAt)}</td>
                    <td className="pd__action">
                      <Button variant="secondary" onClick={() => navigate(`/salespages/${entry.id}`)}>
                        Manage
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {loadError === undefined && pages.length > 0 && rows.length === 0 ? (
            <div className="pd__empty">
              <Icon name="layout" size={22} className="pd__emptyIcon" />
              <p className="pd__emptyTitle">No sales pages match “{query}”</p>
              <p className="pd__emptyHint">Try a different name or URL.</p>
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
          label="Sales pages"
        />
      </div>

      {createOpen ? (
        <div className="pd-modal" role="presentation" onClick={() => setCreateOpen(false)}>
          <div
            className="pd-modal__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sp-create-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="pd-modal__head">
              <h2 id="sp-create-title">Create sales page</h2>
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
                label="Name"
                name="sp-name"
                value={form.name}
                onValueChange={(value) => {
                  setForm((prev) =>
                    slugTouched ? { ...prev, name: value } : { ...prev, name: value, slug: slugify(value) },
                  );
                  if (nameError) setNameError(undefined);
                }}
                placeholder="e.g. Summer Mega Sale"
                error={nameError}
                autoFocus
              />
              <TextField
                label="Slug / URL"
                name="sp-slug"
                value={form.slug}
                onValueChange={(value) => {
                  setSlugTouched(true);
                  setForm((prev) => ({ ...prev, slug: value }));
                  if (slugError) setSlugError(undefined);
                }}
                placeholder="summer-mega-sale"
                error={slugError}
              />
              <p className="pd__slugHint">
                Opens at <strong>/{slugify(form.slug) || slugify(form.name) || "…"}</strong> — leave
                blank to derive from the name.
              </p>
              <ProductSearchSelect products={products} values={picked} onChange={setPicked} />
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
                  Create Now
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}
