"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface Item {
  id: string;
  label: string;
  hint?: string;
  icon: string;
  run: () => void;
}

// Global ⌘K / Ctrl+K command palette: jump between pages, search words, and
// toggle the theme. Mounted once in the AppShell.
export function CommandPalette() {
  const router = useRouter();
  const { accountId } = useAccount();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: words } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
    enabled: open, // only fetch once the palette is opened
  });

  // Open/close on ⌘K (or Ctrl+K), close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const close = () => setOpen(false);

  const items = useMemo<Item[]>(() => {
    const nav: Item[] = [
      { id: "go-today", icon: "🏠", label: "Go to Today", run: () => router.push("/") },
      { id: "go-review", icon: "🃏", label: "Open Flashcards", run: () => router.push("/review") },
      { id: "go-quiz", icon: "🎯", label: "Open Recall check", run: () => router.push("/quiz") },
      { id: "go-words", icon: "📚", label: "Open My words", run: () => router.push("/words") },
      { id: "go-collections", icon: "🗂", label: "Open Collections", run: () => router.push("/collections") },
      {
        id: "theme",
        icon: theme === "dark" ? "☀️" : "🌙",
        label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
        run: () => toggle(),
      },
    ];
    const needle = q.trim().toLowerCase();
    const navMatches = needle
      ? nav.filter((i) => i.label.toLowerCase().includes(needle))
      : nav;
    const wordMatches: Item[] = (words ?? [])
      .filter((w) =>
        needle
          ? w.word.toLowerCase().includes(needle) ||
            (w.meaningZh ?? "").toLowerCase().includes(needle)
          : false,
      )
      .slice(0, 6)
      .map((w) => ({
        id: `word-${w.id}`,
        icon: "🔤",
        label: w.word,
        hint: w.meaningZh ?? undefined,
        run: () => router.push(`/word/${w.id}`),
      }));
    return [...navMatches, ...wordMatches];
  }, [q, words, router, theme, toggle]);

  useEffect(() => {
    if (active >= items.length) setActive(0);
  }, [items.length, active]);

  if (!open) return null;

  const choose = (it: Item) => {
    it.run();
    close();
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && items[active]) {
      e.preventDefault();
      choose(items[active]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[14vh] backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="anim-scale-in w-full max-w-[560px] overflow-hidden rounded-[20px] border border-black/[0.08] bg-surface shadow-[0_30px_80px_rgba(0,0,0,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onListKey}
          placeholder="Search words or jump to a page…"
          className="w-full border-b border-black/[0.06] bg-transparent px-5 py-4 text-[16px] text-ink placeholder:text-ink-faint focus:outline-none"
        />
        <ul className="max-h-[340px] overflow-y-auto py-2">
          {items.length === 0 && (
            <li className="px-5 py-6 text-center text-sm text-ink-soft">No matches.</li>
          )}
          {items.map((it, i) => (
            <li key={it.id}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(it)}
                className={cn(
                  "flex w-full items-center gap-3 px-5 py-3 text-left text-[15px] transition-colors",
                  i === active ? "bg-sage-tint text-sage-deep" : "text-ink hover:bg-black/[0.03]",
                )}
              >
                <span className="text-[17px]">{it.icon}</span>
                <span className="font-medium">{it.label}</span>
                {it.hint && <span className="ml-auto truncate text-sm text-ink-faint">{it.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-black/[0.06] px-5 py-2.5 text-[11px] font-medium text-ink-faint">
          <span>↑↓ to navigate · ↵ to open</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
}
