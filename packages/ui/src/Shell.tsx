import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "./icons";
import type { IconName } from "./icons";

export interface NavItem {
  label: string;
  /** Glyph shown before the label. */
  icon?: IconName;
  /** When set the item renders as a real link; clicks are reported through `onNavigate`. */
  href?: string;
  /** Current page. Exactly one item should be active. */
  active?: boolean;
  /** Placeholder for a section that is not built yet — rendered inert. */
  soon?: boolean;
}

export interface ShellProps {
  userName: string;
  userEmail: string;
  userRole: string;
  /** Brand image path (e.g. `/storesy-icon.png`). Falls back to the "S" mark. */
  brandIcon?: string;
  theme?: "light" | "dark";
  onThemeToggle?: () => void;
  /** Omitted while there is no /profile page yet: the menu item stays inert. */
  onProfile?: () => void;
  /** Extra account-menu items (internal tools), rendered under "My Profile". */
  menuLinks?: Array<{ label: string; href: string }>;
  onLogout: () => void;
  loggingOut?: boolean;
  nav?: NavItem[];
  /** Handles clicks on nav items that carry an `href` (client-side routing lives in the app). */
  onNavigate?: (href: string) => void;
  children: ReactNode;
}

const DEFAULT_NAV: NavItem[] = [{ label: "Dashboard", active: true }];

function ChevronRight({ open }: { open: boolean }) {
  return (
    <svg
      className={open ? "ui-chevron ui-chevron--open" : "ui-chevron"}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function Shell({
  userName,
  userEmail,
  userRole,
  brandIcon,
  theme = "light",
  onThemeToggle,
  onProfile,
  menuLinks,
  onLogout,
  loggingOut = false,
  nav = DEFAULT_NAV,
  onNavigate,
  children,
}: ShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Mobile only: the sidebar is hidden off-canvas until the toggle opens it.
  // Desktop ignores this state (the drawer CSS is inside the mobile query).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Close on outside click or Escape, so the menu never traps the sidebar.
  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!accountRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  // Escape closes the drawer, and the body stops scrolling behind it.
  useEffect(() => {
    if (!sidebarOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSidebarOpen(false);
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [sidebarOpen]);

  // Resizing back to desktop drops the drawer state (and its scroll lock).
  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 860px)");
    function handleChange() {
      if (!mobile.matches) setSidebarOpen(false);
    }
    mobile.addEventListener("change", handleChange);
    return () => mobile.removeEventListener("change", handleChange);
  }, []);

  function handleLogout() {
    setMenuOpen(false);
    setSidebarOpen(false);
    onLogout();
  }

  return (
    <div className={sidebarOpen ? "ui-shell ui-shell--sidebar-open" : "ui-shell"}>
      <header className="ui-shell__mobilebar">
        <button
          type="button"
          className="ui-shell__toggle"
          aria-label={sidebarOpen ? "Close menu" : "Open menu"}
          aria-expanded={sidebarOpen}
          aria-controls="ui-shell-sidebar"
          onClick={() => setSidebarOpen((open) => !open)}
        >
          <Icon name={sidebarOpen ? "close" : "menu"} size={18} />
        </button>
        <span className="ui-shell__mobilebrand">
          {brandIcon ? (
            <img className="ui-shell__logo" src={brandIcon} alt="" width={26} height={26} />
          ) : null}
          Storesy
        </span>
      </header>

      <aside className="ui-shell__sidebar" id="ui-shell-sidebar">
        <div className="ui-shell__brand">
          {brandIcon ? (
            <img className="ui-shell__logo" src={brandIcon} alt="" width={30} height={30} />
          ) : (
            <span className="ui-shell__mark" aria-hidden="true">
              S
            </span>
          )}
          <span className="ui-shell__name">Storesy</span>
          <button
            type="button"
            className="ui-shell__sidebarClose"
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <nav className="ui-shell__nav" aria-label="Main">
          <ul>
            {nav.map((item) => {
              const href = item.href;
              const className = [
                "ui-nav__item",
                item.active ? "ui-nav__item--active" : "",
                item.soon ? "ui-nav__item--soon" : "",
                href ? "ui-nav__item--link" : "",
              ]
                .filter(Boolean)
                .join(" ");
              const inner = (
                <>
                  <span className="ui-nav__main">
                    {item.icon ? <Icon name={item.icon} className="ui-nav__icon" /> : null}
                    {item.label}
                  </span>
                  {item.soon ? <span className="ui-nav__badge">soon</span> : null}
                </>
              );

              // Linked items are real anchors (middle-click, copy link, focus ring all work);
              // plain clicks are delegated to the app so react-router can handle them.
              return (
                <li key={item.label}>
                  {href ? (
                    <a
                      className={className}
                      href={href}
                      aria-current={item.active ? "page" : undefined}
                      onClick={(event) => {
                        if (!onNavigate) return;
                        // Keep browser affordances: cmd/ctrl-click still opens a new tab.
                        if (
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.altKey ||
                          event.button !== 0
                        ) {
                          return;
                        }
                        event.preventDefault();
                        onNavigate(href);
                        setSidebarOpen(false);
                      }}
                    >
                      {inner}
                    </a>
                  ) : (
                    <span className={className} aria-current={item.active ? "page" : undefined}>
                      {inner}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ui-shell__account" ref={accountRef}>
          <div className="ui-shell__identity">
            <div className="ui-shell__identityText">
              <span className="ui-shell__user">{userName}</span>
              <span className="ui-shell__email">{userEmail}</span>
              <span className="ui-shell__role">{userRole}</span>
            </div>

            <button
              type="button"
              className={menuOpen ? "ui-shell__menuButton ui-shell__menuButton--open" : "ui-shell__menuButton"}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              aria-label="Account menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <ChevronRight open={menuOpen} />
            </button>
          </div>

          {menuOpen ? (
            <div className="ui-menu" role="menu" id={menuId}>
              <button
                type="button"
                role="menuitem"
                className="ui-menu__item"
                disabled={!onProfile}
                onClick={() => {
                  setMenuOpen(false);
                  onProfile?.();
                }}
              >
                My Profile
              </button>

              {menuLinks?.map((link) => (
                // Real anchor (middle-click / copy link work); plain clicks are
                // delegated to the app, same as sidebar nav items.
                <a
                  key={link.href}
                  role="menuitem"
                  className="ui-menu__item"
                  href={link.href}
                  onClick={(event) => {
                    setMenuOpen(false);
                    setSidebarOpen(false);
                    if (!onNavigate) return;
                    if (
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey ||
                      event.button !== 0
                    ) {
                      return;
                    }
                    event.preventDefault();
                    onNavigate(link.href);
                  }}
                >
                  {link.label}
                </a>
              ))}

              <button
                type="button"
                role="menuitem"
                className="ui-menu__item"
                onClick={onThemeToggle}
              >
                {theme === "dark" ? "Use Light Mode" : "Use Dark Mode"}
              </button>

              <div className="ui-menu__divider" role="separator" />

              <button
                type="button"
                role="menuitem"
                className="ui-menu__item ui-menu__item--danger"
                onClick={handleLogout}
                disabled={loggingOut}
              >
                {loggingOut ? "Logging out…" : "Logout"}
              </button>
            </div>
          ) : null}
        </div>
      </aside>

      <button
        type="button"
        className="ui-shell__scrim"
        aria-label="Close menu"
        tabIndex={-1}
        onClick={() => setSidebarOpen(false)}
      />

      <main className="ui-shell__main">{children}</main>
    </div>
  );
}
