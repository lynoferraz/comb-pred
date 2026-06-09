"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

const STORAGE_KEY = "cim_theme";

interface ThemeState {
  dark: boolean;
  toggleDark: () => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be inside ThemeProvider");
  return ctx;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(false);

  // Sync from localStorage / DOM on mount (the inline script in layout.tsx
  // already applied the class to avoid a flash).
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleDark = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      try {
        localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
      } catch {}
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ dark, toggleDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

// Inline script (runs before hydration) that applies the persisted theme so
// there's no light→dark flash. Default is light.
export const themeInitScript = `
(function(){
  try {
    var t = localStorage.getItem("${STORAGE_KEY}");
    if (t === "dark") document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;
