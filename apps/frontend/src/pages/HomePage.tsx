import { Card, Shell } from "@storesy/ui";
import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { buildNav, SYSTEM_MENU } from "../lib/nav";
import { useTheme } from "../lib/theme";

interface Section {
  title: string;
  hint: string;
  /** When set, the card links somewhere instead of showing a "soon" badge. */
  href?: string;
  cta?: string;
}

const SECTIONS: Section[] = [
  {
    title: "Stores",
    hint: "Create your first storefront to start selling.",
    href: "/storefront",
    cta: "Open Store Front",
  },
  { title: "Orders", hint: "New orders will appear here once your store is live." },
  { title: "Inventory", hint: "Track stock levels across your products." },
];

export function HomePage() {
  const { user, loading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

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
      <div className="home">
        <header className="home__header">
          <h1 className="home__title">Welcome back, {user.name.split(" ")[0]}</h1>
          <p className="home__subtitle">
            Signed in as {user.email}. Here is what is happening with your business.
          </p>
        </header>

        <div className="home__grid">
          {SECTIONS.map((section) => (
            <Card key={section.title} title={section.title}>
              <p className="home__empty">{section.hint}</p>
              {section.href ? (
                <Link className="home__cta" to={section.href}>
                  {section.cta} →
                </Link>
              ) : (
                <span className="home__badge">Coming soon</span>
              )}
            </Card>
          ))}
        </div>
      </div>
    </Shell>
  );
}
