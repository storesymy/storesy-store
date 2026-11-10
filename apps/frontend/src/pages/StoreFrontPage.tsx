import { Button, Card, Icon, Shell } from "@storesy/ui";
import type { IconName } from "@storesy/ui";
import type { StoreType } from "@storesy/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { CodeEditor } from "../components/CodeEditor";
import { CreateStorePanel } from "../components/CreateStorePanel";
import { LinkEditor } from "../components/LinkEditor";
import { StorePreview } from "../components/StorePreview";
import { useAuth } from "../lib/auth";
import { buildNav, SYSTEM_MENU } from "../lib/nav";
import { useTheme } from "../lib/theme";
import { STORE_TYPES } from "../lib/storeTypes";
import type { CodeFile } from "../lib/useStorefront";
import { useStorefront } from "../lib/useStorefront";
import { composeCodeDocument } from "../lib/codeDocument";

interface RailAction {
  icon: IconName;
  label: string;
  hint: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Inert placeholder for a capability that needs the API phase. */
  soon?: boolean;
}

export function StoreFrontPage() {
  const { user, loading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const studio = useStorefront();
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [codeFile, setCodeFile] = useState<CodeFile>("html");
  const [toast, setToast] = useState<string | null>(null);
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  useEffect(() => {
    if (!linkEditorOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setLinkEditorOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [linkEditorOpen]);

  if (loading) {
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

  const store = studio.store;
  // UI-only phase: the store lives at the current origin (no public domain yet).
  const storeHost = window.location.host;
  const storeOrigin = window.location.origin;

  async function copyText(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(message);
    } catch {
      showToast("Copy failed — copy the link manually.");
    }
  }

  function handleCopyLink() {
    if (store) void copyText(storeOrigin, "Link copied");
  }

  async function handleShare() {
    if (!store) return;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: store.name, url: storeOrigin });
        return;
      } catch (error) {
        // Cancelled share: stop. Anything else: fall back to the clipboard.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    void copyText(storeOrigin, "Link copied");
  }

  function handlePublish() {
    studio.publish();
    showToast("Store published — it's live.");
  }

  function handleUnpublish() {
    studio.unpublish();
    showToast("Store unpublished — back to draft.");
  }

  function handleSetType(next: StoreType) {
    const message = studio.setType(next);
    if (message) showToast(message);
  }

  function handleResetCode() {
    studio.resetCode();
    showToast("Template restored.");
  }

  function handleCopyCode() {
    if (store) void copyText(store.code[codeFile], `${codeFile.toUpperCase()} copied`);
  }

  function handleOpenPreview() {
    if (!store) return;
    const objectUrl = URL.createObjectURL(
      new Blob([composeCodeDocument(store.code)], { type: "text/html" }),
    );
    window.open(objectUrl, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }

  const railActions: RailAction[] = store
    ? [
        { icon: "copy", label: "Copy link", hint: storeHost, onClick: handleCopyLink },
        { icon: "share", label: "Share", hint: "Send your store link", onClick: handleShare },
        { icon: "palette", label: "Edit theme", hint: "Colors, fonts, logo and text", soon: true },
        ...(store.type === "coming-soon"
          ? [
              {
                icon: "email" as IconName,
                label: "Email capture",
                hint: "Collect launch signups",
                soon: true,
              },
            ]
          : []),
        ...(store.type === "ecommerce"
          ? [
              {
                icon: "bag" as IconName,
                label: "Cart & checkout",
                hint: "Payments and shipping",
                soon: true,
              },
            ]
          : []),
        ...(store.type === "sales-page"
          ? [{ icon: "layout" as IconName, label: "Edit sections", hint: "Reorder the page", soon: true }]
          : []),
        ...(store.type === "link-tree"
          ? [
              {
                icon: "link" as IconName,
                label: "Edit Links",
                hint: "Titles and destinations",
                onClick: () => setLinkEditorOpen(true),
              },
              {
                icon: "customers" as IconName,
                label: "Edit profile",
                hint: "Avatar and bio",
                soon: true,
              },
            ]
          : []),
        ...(store.type === "custom-html"
          ? [
              { icon: "reset" as IconName, label: "Reset template", hint: "Restore starter code", onClick: handleResetCode },
              { icon: "copy" as IconName, label: `Copy ${codeFile.toUpperCase()}`, hint: "Copy to clipboard", onClick: handleCopyCode },
              { icon: "eye" as IconName, label: "Open preview", hint: "Runs in a new tab", onClick: handleOpenPreview },
            ]
          : []),
      ]
    : [];

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
      <div className="sf">
        {!store ? (
          <CreateStorePanel onCreate={studio.create} />
        ) : (
          <div className="sf__body">
            <div className="sf__main">
              <div className="sf__panel">
                {store.type === "custom-html" ? (
                  <CodeEditor
                    code={store.code}
                    file={codeFile}
                    onFileChange={setCodeFile}
                    onCodeChange={studio.setCode}
                  />
                ) : (
                  <StorePreview
                    store={store}
                    device={device}
                    onDeviceChange={setDevice}
                  />
                )}
              </div>
            </div>

            <aside className="sf__rail" aria-label="Storefront tools">
              <Card title="Store Front Type">
                <select
                  className="sf-select"
                  aria-label="Store Front Type"
                  value={store.type}
                  onChange={(event) => handleSetType(event.target.value as StoreType)}
                >
                  {STORE_TYPES.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="sf-cardActions">
                  {store.status === "draft" ? (
                    <Button onClick={handlePublish}>Publish</Button>
                  ) : (
                    <Button variant="secondary" onClick={handleUnpublish}>
                      Unpublish
                    </Button>
                  )}
                </div>
              </Card>

              <Card
                title="Quick actions"
                action={
                  <span
                    className={
                      store.status === "active"
                        ? "sf__status sf__status--live"
                        : "sf__status"
                    }
                  >
                    {store.status === "active" ? "Live" : "Draft"}
                  </span>
                }
              >
                <ul className="sf-actions">
                  {railActions.map((action) => {
                    const content = (
                      <>
                        <span className="sf-action__icon" aria-hidden="true">
                          <Icon name={action.icon} size={16} />
                        </span>
                        <span className="sf-action__text">
                          <span className="sf-action__label">{action.label}</span>
                          <span className="sf-action__hint">{action.hint}</span>
                        </span>
                        {action.soon ? <span className="ui-nav__badge">soon</span> : null}
                      </>
                    );

                    return (
                      <li key={action.label}>
                        {action.soon ? (
                          <div className="sf-action sf-action--soon">{content}</div>
                        ) : (
                          <button
                            type="button"
                            className="sf-action"
                            disabled={action.disabled}
                            onClick={action.onClick}
                          >
                            {content}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </aside>
          </div>
        )}

        {toast ? (
          <div className="sf__toast" role="status">
            {toast}
          </div>
        ) : null}

        {linkEditorOpen && store ? (
          <div
            className="sf-modal"
            role="presentation"
            onClick={() => setLinkEditorOpen(false)}
          >
            <div
              className="sf-modal__panel"
              role="dialog"
              aria-modal="true"
              aria-label="Edit links"
              onClick={(event) => event.stopPropagation()}
            >
              <LinkEditor
                links={store.links}
                onAdd={studio.addLink}
                onUpdate={studio.updateLink}
                onRemove={studio.removeLink}
                onMove={studio.moveLink}
                onClose={() => setLinkEditorOpen(false)}
              />
            </div>
          </div>
        ) : null}
      </div>
    </Shell>
  );
}
