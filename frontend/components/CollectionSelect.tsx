"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Collection } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Compact single-select dropdown (with search) for picking a collection to
// filter by. Value "all" means no filter. Scales to many collections better
// than a long wrapping chip row.
export function CollectionSelect({
  options,
  value,
  onChange,
  allLabel,
  className,
}: {
  options: Collection[];
  value: string; // "all" | collection id
  onChange: (v: string) => void;
  allLabel?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const allText = allLabel ?? t("common.allWords");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (open && triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
    if (open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const reposition = () => {
      if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  const current = options.find((o) => o.id === value);
  const label = value === "all" ? allText : (current?.name ?? allText);

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-9 min-w-[160px] items-center justify-between gap-2 rounded-full border px-3.5 text-sm font-semibold transition-colors",
          value !== "all"
            ? "border-transparent bg-sage text-white"
            : open
              ? "border-sage bg-surface text-ink"
              : "border-black/[0.08] bg-surface text-ink-muted hover:bg-black/[0.03]",
        )}
      >
        <span className="truncate">
          {label}
          {current ? <span className="opacity-70"> · {current.count}</span> : null}
        </span>
        <svg
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          className={cn("shrink-0 transition-transform", open && "rotate-180")}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            className="anim-scale-in fixed z-[80] flex max-h-72 flex-col overflow-hidden rounded-[14px] border border-black/[0.08] bg-surface shadow-[0_18px_44px_rgba(46,42,38,0.18)]"
            style={{ left: rect.left, top: rect.bottom + 6, minWidth: Math.max(rect.width, 220) }}
          >
            {options.length > 6 && (
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("col.searchSets")}
                className="border-b border-black/[0.06] bg-transparent px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
              />
            )}
            <ul className="overflow-auto p-1.5">
              <li>
                <button
                  type="button"
                  onClick={() => pick("all")}
                  className={cn(
                    "flex w-full items-center justify-between rounded-[10px] px-2.5 py-2 text-left text-sm transition-colors",
                    value === "all" ? "bg-sage-tint font-semibold text-sage-deep" : "text-ink hover:bg-black/[0.03]",
                  )}
                >
                  {allText}
                  {value === "all" && <span className="text-sage">✓</span>}
                </button>
              </li>
              {filtered.length === 0 && (
                <li className="px-3 py-3 text-center text-sm text-ink-faint">{t("col.noSets")}</li>
              )}
              {filtered.map((o) => {
                const active = o.id === value;
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => pick(o.id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-sm transition-colors",
                        active ? "bg-sage-tint font-semibold text-sage-deep" : "text-ink hover:bg-black/[0.03]",
                      )}
                    >
                      <span className="flex-1 truncate font-medium">{o.name}</span>
                      <span className="text-xs text-ink-faint">{o.count}</span>
                      {active && <span className="text-sage">✓</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
