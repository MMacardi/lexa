"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";
const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "light",
  toggle: () => {},
});

const KEY = "lexa.theme";

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
    const initial =
      stored ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(initial);
    apply(initial);
  }, []);

  function toggle() {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      localStorage.setItem(KEY, next);
      apply(next);
      return next;
    });
  }

  return <ThemeCtx.Provider value={{ theme, toggle }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);

// Runs before paint (injected in <head>) so the page never flashes the wrong
// theme. Kept as a plain string for next/script dangerouslySetInnerHTML.
export const themeBootScript = `
(function(){try{
  var s=localStorage.getItem('${KEY}');
  var d=s? s==='dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  if(d) document.documentElement.classList.add('dark');
}catch(e){}})();
`;
