import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

/** Keep this key in step with the inline script in index.html. */
export const THEME_STORAGE_KEY = "islet-sensor-explorer.theme";

function readStored(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readInitial(): Theme {
  if (typeof window === "undefined") return "light";
  return readStored() ?? systemTheme();
}

/**
 * Light or dark, applied as the "dark" class on the root element. The choice
 * is remembered; with no stored choice the system preference is followed and
 * kept in step if the system changes.
 */
export function useTheme(): {
  theme: Theme;
  setTheme: (next: Theme) => void;
  toggleTheme: () => void;
} {
  const [theme, setThemeState] = useState<Theme>(readInitial);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const list = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      if (readStored() === null) setThemeState(event.matches ? "dark" : "light");
    };
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be blocked. The choice then lasts for this visit only.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Storage can be blocked.
      }
      return next;
    });
  }, []);

  return { theme, setTheme, toggleTheme };
}
