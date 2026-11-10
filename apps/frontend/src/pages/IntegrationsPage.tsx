import { INTEGRATION_PROVIDERS, isAdminRole, providerOf } from "@storesy/shared";
import type {
  IntegrationProvider,
  IntegrationRecord,
  UpdateIntegrationInput,
} from "@storesy/shared";
import { Button, Icon, Shell } from "@storesy/ui";
import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ConnectModal } from "../components/ConnectModal";
import { IntegrationDetailsModal } from "../components/IntegrationDetailsModal";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { buildNav, SYSTEM_MENU } from "../lib/nav";
import { useTheme } from "../lib/theme";

/**
 * The integrations grid at /integrations: three cards to a row at a 5:3
 * ratio, one card per catalogue provider. Each card lists the instances
 * STORED for that provider (live rows from the admin-only API — reads carry
 * masked hints, never a secret): a name opens its details, from which the
 * instance can be edited or deleted. The "+" is ALWAYS shown — a connected
 * provider can hold another instance — and opens the setup dialog to add one.
 */
export function IntegrationsPage() {
  const { user, loading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const [rows, setRows] = useState<IntegrationRecord[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [listError, setListError] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);

  /** The provider whose setup dialog is open (its "+" was pressed). */
  const [connectingId, setConnectingId] = useState<string | null>(null);
  /** The row whose details are open. */
  const [detailUuid, setDetailUuid] = useState<string | null>(null);

  // The list loads from the API; a dead session bounces to login like any
  // signed-out page (the effect runs for anonymous visitors too, on purpose).
  useEffect(() => {
    let cancelled = false;
    setLoadingRows(true);
    setListError(undefined);
    api
      .integrations()
      .then(({ integrations }) => {
        if (!cancelled) setRows(integrations);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setListError(error instanceof Error ? error.message : "Could not load integrations.");
      })
      .finally(() => {
        if (!cancelled) setLoadingRows(false);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, reloadKey]);

  function reload() {
    setReloadKey((key) => key + 1);
  }

  const rowsFor = (providerId: string): IntegrationRecord[] =>
    rows.filter((row) => row.provider === providerId);
  const connectedCount = INTEGRATION_PROVIDERS.filter((provider) =>
    rowsFor(provider.id).some((row) => row.connected),
  ).length;

  const connectingProvider = connectingId === null ? undefined : providerOf(connectingId);
  const detailRow = detailUuid === null ? undefined : rows.find((row) => row.uuid === detailUuid);
  const detailProvider = detailRow ? providerOf(detailRow.provider) : undefined;

  if (loading || loadingRows) {
    return (
      <div className="page-loading" role="status">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  // Integrations is admin-only at the API too — this just keeps the route
  // itself from rendering for anyone who would be refused there.
  if (!isAdminRole(user.role)) return <Navigate to="/home" replace />;

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  /** Connect: the dialog's values become a row (name column + fields). */
  async function handleConnect(provider: IntegrationProvider, values: Record<string, string>) {
    const { name, ...fields } = values;
    await api.createIntegration({ provider: provider.id, name: (name ?? "").trim(), fields });
    setConnectingId(null);
    reload();
  }

  /** Inline save from the details modal: one field, then refresh. */
  async function handleSaveField(uuid: string, patch: UpdateIntegrationInput) {
    await api.updateIntegration(uuid, patch);
    reload();
  }

  /** Delete: the row goes; if it was the provider's last, "+" comes back. */
  async function handleDelete(uuid: string) {
    await api.deleteIntegration(uuid);
    setDetailUuid(null);
    reload();
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
            <h1 className="pd__title">Integrations</h1>
            <p className="pd__sub">
              {INTEGRATION_PROVIDERS.length} Category · {connectedCount} connected
            </p>
          </div>
        </header>

        {listError ? (
          <div className="pd__panel">
            <div className="pd__empty">
              <Icon name="integrations" size={22} className="pd__emptyIcon" />
              <p className="pd__emptyTitle">Could not load integrations</p>
              <p className="pd__emptyHint">{listError}</p>
              <button type="button" className="pd__clear" onClick={reload}>
                Try again
              </button>
            </div>
          </div>
        ) : (
          <div className="itg__grid">
            {INTEGRATION_PROVIDERS.map((provider) => {
              const instances = rowsFor(provider.id);
              const connected = instances.some((row) => row.connected);
              return (
                <article
                  key={provider.id}
                  className={connected ? "itg-card itg-card--connected" : "itg-card"}
                >
                  <div className="itg-card__head">
                    {/* The letter sits under the favicon: if the provider's
                        icon never loads, the img hides itself and the
                        initial takes its place — no state, no broken box. */}
                    <span className="itg-card__favicon" aria-hidden="true">
                      <span className="itg-card__letter">{provider.label.charAt(0)}</span>
                      <img
                        src={
                          provider.faviconUrl ??
                          `https://${provider.domain}${provider.faviconPath ?? "/favicon.ico"}`
                        }
                        alt=""
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    </span>
                    <span className="itg-card__brand">{provider.label}</span>
                    <span className="itg-card__cat">{provider.category}</span>
                  </div>

                  <p className="itg-card__desc">{provider.description}</p>

                  {/* Stored instances — each numbered name opens its details. */}
                  <div className="itg-card__names">
                    {instances.map((row, index) => (
                      <button
                        key={row.uuid}
                        type="button"
                        className="itg-card__nameRow"
                        onClick={() => setDetailUuid(row.uuid)}
                      >
                        <span className="itg-card__nameNum">{index + 1}.</span>
                        <span className="itg-card__nameLabel">{row.name}</span>
                      </button>
                    ))}
                  </div>

                  <div className="itg-card__foot">
                    {/* Always rendered, connected or not — the status pill
                        was removed, and "+" lets a connected provider grow
                        another instance. Icon-only, so the label lives in
                        aria-label + title for screen readers and hover. */}
                    <Button
                      className="itg-card__cta"
                      aria-label="Connect"
                      title="Connect"
                      onClick={() => setConnectingId(provider.id)}
                    >
                      <Icon name="plus" size={16} />
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {connectingProvider ? (
        <ConnectModal
          provider={connectingProvider}
          onClose={() => setConnectingId(null)}
          onConnect={(values) => handleConnect(connectingProvider, values)}
        />
      ) : null}

      {detailRow && detailProvider ? (
        <IntegrationDetailsModal
          provider={detailProvider}
          entry={detailRow}
          onClose={() => setDetailUuid(null)}
          onDelete={() => handleDelete(detailRow.uuid)}
          onTestEmail={(overrides) => api.testIntegrationEmail(detailRow.uuid, overrides)}
          onSaveField={(patch) => handleSaveField(detailRow.uuid, patch)}
          sessionEmail={user.email}
        />
      ) : null}

    </Shell>
  );
}
