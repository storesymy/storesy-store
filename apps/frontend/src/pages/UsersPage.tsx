import { GROUP_DEFAULT_MENUS, MENU_ITEMS, isAdminOnlyMenu } from "@storesy/shared";
import type { InviteRole, MenuKey, User, UserListRow, UserPage } from "@storesy/shared";
import { Button, Icon, Pager, SelectField, Shell } from "@storesy/ui";
import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { SYSTEM_MENU, useAppNav } from "../lib/nav";
import { useTheme } from "../lib/theme";

const PER_PAGE = 30;
const SEARCH_DEBOUNCE_MS = 250;

function groupLabel(role: string): string {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return "Staff";
}

export function UsersPage() {
  const { user, loading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  const nav = useAppNav(location.pathname, user);
  const navigate = useNavigate();
  const notice = (location.state as { notice?: string } | null)?.notice;

  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<UserPage | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);
  const [manage, setManage] = useState<UserListRow | null>(null);

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
    setLoadingUsers(true);
    setLoadError(undefined);
    api
      .users({ q: search, page, perPage: PER_PAGE })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setLoadError(error instanceof ApiError ? error.message : "Could not load users.");
      })
      .finally(() => {
        if (!cancelled) setLoadingUsers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [search, page, reloadKey, navigate]);

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
  if (user.role !== "owner" && user.role !== "admin") return <Navigate to="/home" replace />;

  const users = data?.users ?? [];
  const total = data?.total ?? 0;
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
      nav={nav}
      onNavigate={(href) => navigate(href)}
      menuLinks={user.role === "owner" ? SYSTEM_MENU : undefined}
    >
      <div className="pd">
        <header className="pd__header">
          <div>
            <h1 className="pd__title">User</h1>
            <p className="pd__sub">
              {loadingUsers ? "Loading users…" : `${total} ${total === 1 ? "user" : "users"}`}
            </p>
          </div>
          <Button onClick={() => navigate("/invite-user")}>
            <Icon name="plus" size={15} /> Invite User
          </Button>
        </header>

        {notice ? (
          <p className="tpl__notice" role="status">
            <Icon name="check" size={14} /> {notice}
          </p>
        ) : null}

        <div className="pd__toolbar">
          <label className="pd__search">
            <Icon name="search" size={15} className="pd__searchIcon" />
            <input
              className="pd__searchInput"
              type="search"
              placeholder="Search name or email…"
              aria-label="Search users"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="pd__toolbarActions">
            <span className="pd__resultCount">
              {loadingUsers ? "Searching…" : search ? `${total} matches` : `${total} total`}
            </span>
            <Button variant="secondary" onClick={() => setReloadKey((key) => key + 1)}>
              Refresh
            </Button>
          </div>
        </div>

        <div className="pd__panel">
          {loadError ? (
            <div className="pd__empty">
              <Icon name="customers" size={22} className="pd__emptyIcon" />
              <p className="pd__emptyTitle">Could not load users</p>
              <p className="pd__emptyHint">{loadError}</p>
              <button
                type="button"
                className="pd__clear"
                onClick={() => setReloadKey((key) => key + 1)}
              >
                Try again
              </button>
            </div>
          ) : !loadingUsers && total === 0 ? (
            <div className="pd__empty">
              <Icon name="customers" size={22} className="pd__emptyIcon" />
              <p className="pd__emptyTitle">{search ? `No users match “${search}”` : "No users yet"}</p>
              <p className="pd__emptyHint">
                {search ? "Try a different name or email." : "Invite the first team member."}
              </p>
            </div>
          ) : (
            <table className="pd__table" aria-label="Users">
              <thead>
                <tr>
                  <th scope="col">No</th>
                  <th scope="col">User details</th>
                  <th scope="col">Group</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="pd__action">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((row) => (
                  <tr className="pd__row" key={row.id}>
                    <td>
                      <span className="pd__code">{row.userNo}</span>
                    </td>
                    <td>
                      <span className="pd__name">{row.name}</span>
                      <br />
                      <span className="pd__code">{row.email}</span>
                    </td>
                    <td>{groupLabel(row.role)}</td>
                    <td>
                      <span className={`pd__pill users__status users__status--${row.statusLabel.toLowerCase()}`}>
                        {row.statusLabel}
                      </span>
                    </td>
                    <td className="pd__action">
                      {row.role === "owner" || (user.role === "admin" && row.role === "admin") ? (
                        <Button variant="secondary" className="pd__manage" disabled>
                          Manage
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          className="pd__manage"
                          onClick={() => setManage(row)}
                        >
                          Manage
                        </Button>
                      )}
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
            label="User pages"
          />
        ) : null}
      </div>

      {manage ? (
        <ManageUserModal
          entry={manage}
          actor={user}
          onClose={() => setManage(null)}
          onChanged={(message) => {
            setManage(null);
            setReloadKey((key) => key + 1);
            if (message) navigate("/users", { replace: true, state: { notice: message } });
          }}
        />
      ) : null}
    </Shell>
  );
}

/* ------------------------------- Manage ---------------------------------- */

function ManageUserModal({
  entry,
  actor,
  onClose,
  onChanged,
}: {
  entry: UserListRow;
  actor: User;
  onClose: () => void;
  onChanged: (notice?: string) => void;
}) {
  const [role, setRole] = useState<InviteRole>(entry.role === "admin" ? "admin" : "staff");
  const [menuAccess, setMenuAccess] = useState<MenuKey[]>(entry.menuAccess);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const canAssignAdmin = actor.role === "owner";
  const pending = entry.status === "invited";

  function changeRole(next: InviteRole) {
    setRole(next);
    setMenuAccess(GROUP_DEFAULT_MENUS[next]);
  }

  function toggleMenu(key: MenuKey) {
    if (role === "staff" && isAdminOnlyMenu(key)) return;
    setMenuAccess((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
    );
  }

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      await api.updateUser(entry.id, { role, menuAccess });
      onChanged("User access updated.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the user.");
      setSaving(false);
    }
  }

  async function resend() {
    setSaving(true);
    setError(undefined);
    try {
      await api.resendInvite(entry.id);
      onChanged("Invitation resent.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not resend the invitation.");
      setSaving(false);
    }
  }

  async function revoke() {
    setSaving(true);
    setError(undefined);
    try {
      await api.revokeInvite(entry.id);
      onChanged("Invitation revoked.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not revoke the invitation.");
      setSaving(false);
    }
  }

  return (
    <div className="pd-modal" role="presentation" onClick={onClose}>
      <div
        className="pd-modal__panel users__modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-user-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="pd-modal__head">
          <h2 id="manage-user-title">Manage {entry.name}</h2>
          <button type="button" className="pd-modal__close" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={15} />
          </button>
        </header>
        <div className="pd-modal__body">
          <p className="users__email">{entry.email}</p>
          <SelectField
            label="User group"
            name="role"
            value={role}
            options={[
              ...(canAssignAdmin ? [{ value: "admin", label: "Admin" }] : []),
              { value: "staff", label: "Staff" },
            ]}
            onValueChange={(value) => changeRole(value as InviteRole)}
            disabled={saving}
          />
          <div className="users__menus">
            <p className="users__menusTitle">Sidebar access</p>
            {MENU_ITEMS.map((item) => {
              const disabled = saving || (role === "staff" && item.adminOnly === true);
              return (
                <label key={item.key} className={disabled ? "users__menu users__menu--disabled" : "users__menu"}>
                  <input
                    type="checkbox"
                    checked={menuAccess.includes(item.key)}
                    disabled={disabled}
                    onChange={() => toggleMenu(item.key)}
                  />
                  <span>{item.label}</span>
                </label>
              );
            })}
          </div>
          {error ? (
            <p className="pd-modal__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="pd-modal__actions users__modalActions">
            {pending ? (
              <>
                <Button variant="secondary" onClick={() => void revoke()} disabled={saving}>
                  Revoke
                </Button>
                <Button variant="secondary" onClick={() => void resend()} disabled={saving}>
                  Resend invite
                </Button>
              </>
            ) : null}
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Close
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
