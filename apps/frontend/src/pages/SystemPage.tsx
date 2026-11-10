import type { DbConfig, DbDataPage, DbStructure, DbTable } from "@storesy/shared";
import { Alert, Card, Pager, Shell } from "@storesy/ui";
import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { buildNav, SYSTEM_MENU } from "../lib/nav";
import { useTheme } from "../lib/theme";

type Tab = "data" | "structure";

/** Rows per page in the Data view (the default). */
const DATA_PAGE_SIZE = 50;

/** Index origin codes from PRAGMA index_list, spelled out. */
const INDEX_ORIGIN: Record<string, string> = {
  c: "created",
  u: "unique constraint",
  pk: "primary key",
};

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Could not reach the database viewer.";
}

function renderCell(value: unknown) {
  if (value === null || value === undefined) return <span className="dbm__null">NULL</span>;
  if (typeof value === "number") return <span className="dbm__num">{value}</span>;
  return String(value);
}

function cellTitle(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return undefined;
}

/** `users` is the table worth showing first; otherwise any table will do. */
function pickDefaultTable(tables: DbTable[]): string | null {
  return tables.find((table) => table.name === "users")?.name ?? tables[0]?.name ?? null;
}

/**
 * Owner-only, read-only database viewer at /system. The connection info is the
 * page header; below it a toolbar (table dropdown + Data / Structure buttons)
 * sits directly on top of the table view — Data (50 rows/page) is the default.
 * No sidebar entry — reached from the account menu (see SYSTEM_MENU).
 */
export function SystemPage() {
  const { user, loading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const [config, setConfig] = useState<DbConfig | null>(null);
  const [tables, setTables] = useState<DbTable[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("data");

  const [structure, setStructure] = useState<DbStructure | null>(null);
  const [data, setData] = useState<DbDataPage | null>(null);
  const [page, setPage] = useState(1);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const isOwner = user?.role === "owner";

  // Config + table list, once the session probe resolves for an owner.
  // `users` becomes the selection so the page opens on the meaningful data.
  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    setListLoading(true);
    setListError(null);
    Promise.all([api.dbConfig(), api.dbTables()])
      .then(([cfg, list]) => {
        if (cancelled) return;
        setConfig(cfg);
        setTables(list.tables);
        setSelected((current) => current ?? pickDefaultTable(list.tables));
      })
      .catch((error: unknown) => {
        if (!cancelled) setListError(messageOf(error));
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOwner]);

  // Rows: fetched when the Data tab is open (the default view), cached per table+page.
  useEffect(() => {
    if (!selected || tab !== "data") return;
    if (data && data.table === selected && data.page === page) return;
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    api
      .dbData(selected, page, DATA_PAGE_SIZE)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) setDetailError(messageOf(error));
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `data` is the cache being checked, not a dependency to retrigger on.
  }, [selected, tab, page]);

  // Structure: fetched when the Structure tab is open, cached per table.
  useEffect(() => {
    if (!selected || tab !== "structure") return;
    if (structure && structure.table === selected) return;
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    api
      .dbStructure(selected)
      .then((result) => {
        if (!cancelled) setStructure(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) setDetailError(messageOf(error));
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `structure` is the cache being checked, not a dependency to retrigger on.
  }, [selected, tab]);

  function selectTable(name: string) {
    setSelected(name);
    setPage(1);
    setStructure(null);
    setData(null);
    setDetailError(null);
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

  if (loading) {
    return (
      <div className="page-loading" role="status">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "owner") return <Navigate to="/home" replace />;

  const local = config?.storage === "local-sqlite";

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
      menuLinks={SYSTEM_MENU}
    >
      <div className="dbm">
        {/* Header = the connection info itself: where the rows live right now. */}
        <header
          className={
            !config
              ? "dbm__conn"
              : local
                ? "dbm__conn dbm__conn--local"
                : "dbm__conn dbm__conn--cloud"
          }
        >
          {config ? (
            <>
              <div className="dbm__connTop">
                <p className="dbm__storageLabel">
                  <span className="dbm__storageBadge">
                    {local ? "local sqlite" : "cloudflare d1"}
                  </span>
                  <span>{local ? "Stored on this machine" : "Stored in Cloudflare D1"}</span>
                </p>
                <span className="dbm__env">{config.environment}</span>
              </div>

              <p className="dbm__storageDetail">{config.location}</p>

              <dl className="dbm__facts">
                <div className="dbm__fact">
                  <dt>Host</dt>
                  <dd className="dbm__mono">{config.host}</dd>
                </div>
                <div className="dbm__fact">
                  <dt>User</dt>
                  <dd className="dbm__mono">{config.user}</dd>
                </div>
                <div className="dbm__fact">
                  <dt>Name</dt>
                  <dd className="dbm__mono">{config.name}</dd>
                </div>
                <div className="dbm__fact">
                  <dt>Engine</dt>
                  <dd>{config.engine}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="dbm__hint dbm__hint--inline">
              {listLoading ? "Loading…" : "Connection details unavailable."}
            </p>
          )}
        </header>

        <Card>
          {listError ? <Alert tone="error">{listError}</Alert> : null}

          {/* Toolbar sits directly on top of the table view. */}
          <div className="dbm__toolbar">
            <label className="dbm__pick">
              <span className="dbm__pickLabel">Table</span>
              <select
                className="dbm__select"
                value={selected ?? ""}
                disabled={tables.length === 0}
                onChange={(event) => selectTable(event.target.value)}
              >
                {selected === null ? (
                  <option value="">
                    {listLoading ? "Loading…" : tables.length === 0 ? "No tables" : "Select a table"}
                  </option>
                ) : null}
                {tables.map((table) => (
                  <option key={table.name} value={table.name}>
                    {table.rows === null ? table.name : `${table.name} (${table.rows})`}
                  </option>
                ))}
              </select>
            </label>

            <div className="dbm__tabs" role="tablist" aria-label="Table view">
              <button
                type="button"
                role="tab"
                className={tab === "data" ? "dbm__tab dbm__tab--active" : "dbm__tab"}
                aria-selected={tab === "data"}
                onClick={() => setTab("data")}
              >
                Data
              </button>
              <button
                type="button"
                role="tab"
                className={tab === "structure" ? "dbm__tab dbm__tab--active" : "dbm__tab"}
                aria-selected={tab === "structure"}
                onClick={() => setTab("structure")}
              >
                Structure
              </button>
            </div>
          </div>

          {!selected ? (
            <p className="dbm__hint">
              {listLoading ? "Loading…" : "No tables found in this database."}
            </p>
          ) : detailError ? (
            <Alert tone="error">{detailError}</Alert>
          ) : tab === "data" ? (
            data ? (
              data.rows.length === 0 ? (
                <p className="dbm__hint">
                  {data.total === 0 ? "No rows in this table." : "No rows on this page."}
                </p>
              ) : (
                <>
                  <div className="dbm__dataWrap">
                    <table className="dbm__table dbm__table--data">
                      <thead>
                        <tr>
                          {data.columns.map((column) => (
                            <th key={column}>{column}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.rows.map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {row.map((cell, cellIndex) => (
                              <td key={cellIndex} className="dbm__cell" title={cellTitle(cell)}>
                                {renderCell(cell)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <DataPager data={data} page={page} onPageChange={setPage} />
                </>
              )
            ) : (
              <p className="dbm__hint">{detailLoading ? "Loading…" : "—"}</p>
            )
          ) : structure ? (
            <div className="dbm__structure">
              {/* Left: the column structure. */}
              <div className="dbm__dataWrap">
                <table className="dbm__table">
                  <thead>
                    <tr>
                      <th>Column</th>
                      <th>Type</th>
                      <th>Nullable</th>
                      <th>Default</th>
                      <th>Key</th>
                    </tr>
                  </thead>
                  <tbody>
                    {structure.columns.map((column) => (
                      <tr key={column.name}>
                        <td className="dbm__mono">{column.name}</td>
                        <td className="dbm__mono dbm__muted">{column.type || "—"}</td>
                        <td>{column.notnull ? "no" : "yes"}</td>
                        <td className="dbm__mono dbm__muted">{column.dflt ?? "—"}</td>
                        <td>
                          {column.pk ? (
                            <span className="dbm__pk">PK</span>
                          ) : (
                            <span className="dbm__muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Right: indexes + foreign keys. */}
              <div className="dbm__structureSide">
                <div className="dbm__section">
                  <h3 className="dbm__sectionTitle">Indexes ({structure.indexes.length})</h3>
                  {structure.indexes.length === 0 ? (
                    <p className="dbm__muted dbm__note">No indexes.</p>
                  ) : (
                    <ul className="dbm__meta">
                      {structure.indexes.map((index) => (
                        <li key={index.name}>
                          <code className="dbm__mono">{index.name}</code>
                          <span className="dbm__metaTags">
                            {index.unique ? <span className="dbm__tag">UNIQUE</span> : null}
                            <span className="dbm__muted">
                              {INDEX_ORIGIN[index.origin] ?? index.origin}
                            </span>
                            <span className="dbm__muted">({index.columns.join(", ")})</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="dbm__section">
                  <h3 className="dbm__sectionTitle">
                    Foreign keys ({structure.foreignKeys.length})
                  </h3>
                  {structure.foreignKeys.length === 0 ? (
                    <p className="dbm__muted dbm__note">No foreign keys.</p>
                  ) : (
                    <ul className="dbm__meta">
                      {structure.foreignKeys.map((key, index) => (
                        <li key={`${key.table}.${key.from}.${index}`}>
                          <code className="dbm__mono">
                            {key.from} → {key.table}.{key.to ?? "*"}
                          </code>
                          <span className="dbm__metaTags">
                            <span className="dbm__muted">
                              ON DELETE {key.onDelete} · ON UPDATE {key.onUpdate}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="dbm__hint">{detailLoading ? "Loading…" : "—"}</p>
          )}
        </Card>
      </div>
    </Shell>
  );
}

/** "Showing x–y of z" pager, clamped so an out-of-range page never reads odd. */
function DataPager({
  data,
  page,
  onPageChange,
}: {
  data: DbDataPage;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * data.pageSize;
  const from = data.total === 0 ? 0 : start + 1;
  const to = Math.min(start + data.pageSize, data.total);

  return (
    <Pager
      page={safePage}
      pageCount={pageCount}
      from={from}
      to={to}
      total={data.total}
      onPageChange={onPageChange}
      label="Data pages"
    />
  );
}
