"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n, LOCALES } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { Check, Sun, Moon, Globe, ChevronDown } from "lucide-react";

// Header controls and the scroll reveal shared by both landings — the full one
// (`LandingScreen`) and the focused HSK one (`FocusLanding`). Nothing here knows
// which is rendering; it is just the chrome around whichever copy is in play.

export function LangMenu() {
  const { locale, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const cur = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.1] px-3 py-2 text-sm font-semibold text-ink-muted transition-colors hover:border-sage/60 hover:text-ink">
        <Globe className="h-4 w-4" /> {cur.label} <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <>
          <button type="button" aria-hidden className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1.5 min-w-[120px] overflow-hidden rounded-[14px] border border-black/[0.08] bg-surface p-1 shadow-[0_16px_40px_rgba(46,42,38,0.18)]">
            {LOCALES.map((l) => (
              <button key={l.code} type="button" onClick={() => { setLocale(l.code); setOpen(false); }} className="flex w-full items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-sm font-semibold text-ink-muted transition-colors hover:bg-sage-tint hover:text-sage-deep">
                {l.label}
                {l.code === locale && <Check className="h-4 w-4 text-sage-deep" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" onClick={toggle} aria-label="Toggle theme" className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/[0.1] text-ink-muted transition-colors hover:border-sage/60 hover:text-ink">
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

// Reveal on scroll into view.
export function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && (el.classList.add("reveal-in"), io.unobserve(el))),
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${className}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}
