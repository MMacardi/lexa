"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { prefersReducedMotion } from "@/lib/motion";
import { THEME_KEY as KEY } from "@/lib/themeBoot";

type Theme = "light" | "dark";
const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "light",
  toggle: () => {},
});

function apply(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  // Read the stored / system preference once on mount. The inline script in the
  // layout already set the class to avoid a flash; this just syncs React state.
  useEffect(() => {
    const stored = localStorage.getItem(KEY) as Theme | null;
    // Default to light for new visitors (ignore the OS preference); only an
    // explicit earlier choice switches to dark.
    const initial = stored ?? "light";
    setTheme(initial);
    apply(initial);
  }, []);

  function toggle() {
    const next: Theme = document.documentElement.classList.contains("dark") ? "light" : "dark";
    const swap = () => {
      localStorage.setItem(KEY, next);
      apply(next);
      setTheme(next);
    };
    // Every surface re-colours at once, but only <body> has a colour transition,
    // so the cards used to snap while the page behind them faded. A view
    // transition cross-fades the whole screen as one picture instead; browsers
    // without it keep the old instant switch.
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (doc.startViewTransition && !prefersReducedMotion()) doc.startViewTransition(swap);
    else swap();
  }

  return <ThemeCtx.Provider value={{ theme, toggle }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
