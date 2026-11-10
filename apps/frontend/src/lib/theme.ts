import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "storesy-theme";

export function resolveTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // Storage can be unavailable (private mode) — fall back to the default.
  }
  // Light is the default mode; dark is only used when the user opts in.
  return "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Non-fatal: the theme simply won't persist.
  }
}

/** Theme state shared by every page that renders the shell's account menu. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(resolveTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function toggle() {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  return [theme, toggle];
}
