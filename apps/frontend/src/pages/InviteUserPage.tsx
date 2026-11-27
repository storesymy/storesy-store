import {
  GROUP_DEFAULT_MENUS,
  MENU_ITEMS,
  inviteUserSchema,
  isAdminOnlyMenu,
} from "@storesy/shared";
import type { InviteRole, MenuKey } from "@storesy/shared";
import { Alert, Button, Icon, SelectField, Shell, TextField } from "@storesy/ui";
import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAppNav } from "../lib/nav";
import { useTheme } from "../lib/theme";

type FieldErrors = Partial<Record<"name" | "email", string>>;

export function InviteUserPage() {
  const { user, loading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  const nav = useAppNav(location.pathname, user);
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("staff");
  const [menuAccess, setMenuAccess] = useState<MenuKey[]>(GROUP_DEFAULT_MENUS.staff);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

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

  const canInviteAdmin = user.role === "owner";

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    const parsed = inviteUserSchema.safeParse({ name, email, role, menuAccess });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if ((key === "name" || key === "email") && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      if (Object.keys(next).length === 0) setFormError(parsed.error.issues[0]?.message);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await api.inviteUser(parsed.data);
      navigate("/users", {
        replace: true,
        state: { notice: `Invitation sent to ${parsed.data.email}.` },
      });
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors((error.fields as FieldErrors | undefined) ?? {});
        setFormError(error.message);
      } else {
        setFormError("Could not send the invitation.");
      }
      setSubmitting(false);
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
      nav={nav}
      onNavigate={(href) => navigate(href)}
      menuLinks={user.role === "owner" ? [{ label: "System", href: "/system" }] : undefined}
    >
      <div className="pd">
        <header className="pd__header">
          <div>
            <h1 className="pd__title">Invite User</h1>
            <p className="pd__sub">Send a 48-hour invitation link by email.</p>
          </div>
          <Button variant="secondary" onClick={() => navigate("/users")}>
            Back to users
          </Button>
        </header>

        <form className="pd__panel users__invite" onSubmit={handleSubmit} noValidate>
          {formError ? <Alert>{formError}</Alert> : null}
          <TextField
            label="Name"
            name="name"
            value={name}
            onValueChange={(value) => {
              setName(value);
              setErrors((prev) => ({ ...prev, name: undefined }));
            }}
            error={errors.name}
            placeholder="Full name"
            required
          />
          <TextField
            label="Email"
            name="email"
            type="email"
            value={email}
            onValueChange={(value) => {
              setEmail(value);
              setErrors((prev) => ({ ...prev, email: undefined }));
            }}
            error={errors.email}
            placeholder="name@company.com"
            required
          />
          <SelectField
            label="User group"
            name="role"
            value={role}
            options={[
              ...(canInviteAdmin ? [{ value: "admin", label: "Admin" }] : []),
              { value: "staff", label: "Staff" },
            ]}
            onValueChange={(value) => changeRole(value as InviteRole)}
          />

          <div className="users__menus users__menus--invite">
            <p className="users__menusTitle">Sidebar access</p>
            <p className="users__menusHint">
              Pre-checked from the group. Untick anything the user should not see.
            </p>
            {MENU_ITEMS.map((item) => {
              const locked = role === "staff" && item.adminOnly === true;
              const disabled = submitting || locked;
              return (
                <label
                  key={item.key}
                  className={locked ? "users__menu users__menu--disabled" : "users__menu"}
                >
                  <input
                    type="checkbox"
                    checked={menuAccess.includes(item.key)}
                    disabled={disabled}
                    onChange={() => toggleMenu(item.key)}
                  />
                  <span>{item.label}</span>
                  {locked ? <em>admin only</em> : null}
                </label>
              );
            })}
          </div>

          <div className="users__inviteActions">
            <Button variant="secondary" type="button" onClick={() => navigate("/users")}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Sending…" : "Send Invitation"}
            </Button>
          </div>
        </form>
      </div>
    </Shell>
  );
}
