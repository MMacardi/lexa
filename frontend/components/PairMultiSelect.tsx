"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { pairLabel } from "@/lib/langs";
import { useI18n } from "@/lib/i18n";
import { Checkbox } from "@/components/ui/Checkbox";
import { cn } from "@/lib/utils";

// Compact multi-select for language pairs (each item is "src>tgt"). Replaces a
// long wrapping chip row with a searchable dropdown + select-all/clear, so it
// stays tidy when a user has many pairs.
export function PairMultiSelect({
  pairs,
  selected,
  onChange,
}: {
  pairs: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const label = (p: string) => {
    const [s, tgt] = p.split(">");
    return pairLabel(s, tgt);
  };

  useLayoutEffect(() => {
    if (open && triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
    if (open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => triggerRef.current && setRect(triggerRef.current.getBoundingClientRect());
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
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

  const toggle = (p: string) =>
    onChange(selected.includes(p) ? selected.filter((x) => x !== p) : [...selected, p]);

  const q = query.trim().toLowerCase();
  const filtered = q ? pairs.filter((p) => label(p).toLowerCase().includes(q)) : pairs;
  const allSelected = pairs.length > 0 && pairs.every((p) => selected.includes(p));

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-10 min-w-[200px] items-center justify-between gap-2 rounded-[14px] border bg-surface px-3.5 text-sm font-semibold transition-colors",
          open ? "border-sage text-ink" : "border-black/[0.08] text-ink-muted hover:border-black/20",
        )}
      >
        <span className="truncate">{t("review.pairsSelected", { n: selected.length, total: pairs.length })}</span>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className={cn("shrink-0 text-ink-faint transition-transform", open && "rotate-180")}>
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            className="anim-scale-in fixed z-[80] flex max-h-80 w-[min(320px,90vw)] flex-col overflow-hidden rounded-[14px] border border-black/[0.08] bg-surface shadow-[0_18px_44px_rgba(46,42,38,0.18)]"
            style={{ left: rect.left, top: rect.bottom + 6 }}
          >
            {pairs.length > 6 && (
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("review.searchPairs")}
                className="border-b border-black/[0.06] bg-transparent px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
              />
            )}
            <div className="flex items-center justify-between border-b border-black/[0.06] px-3.5 py-2">
              <button type="button" onClick={() => onChange(allSelected ? [] : [...pairs])} className="text-xs font-semibold text-sage hover:text-sage-deep">
                {allSelected ? t("review.clearAll") : t("review.selectAllPairs")}
              </button>
              <span className="text-xs text-ink-faint">{selected.length}/{pairs.length}</span>
            </div>
            <ul className="overflow-auto p-1.5">
              {filtered.length === 0 && (
                <li className="px-3 py-3 text-center text-sm text-ink-faint">{t("common.noMatches")}</li>
              )}
              {filtered.map((p) => (
                <li key={p}>
                  <button
                    type="button"
                    onClick={() => toggle(p)}
                    className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-sm text-ink transition-colors hover:bg-black/[0.03]"
                  >
                    <Checkbox presentational checked={selected.includes(p)} />
                    <span className="font-medium">{label(p)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
