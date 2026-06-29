"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Collection } from "@/lib/api";
import { cn } from "@/lib/utils";

// Pretty dropdown multi-select for collections (same look as LangSelect, but you
// can tick several). Menu is portalled to <body> so it floats above the page.
export function CollectionMultiSelect({
  options,
  value,
  onChange,
  className,
}: {
  options: Collection[];
  value: string[];
  onChange: (ids: string[]) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    if (open && triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  const selected = options.filter((o) => value.includes(o.id));
  const summary =
    selected.length === 0
      ? "No collection"
      : selected.length === 1
        ? selected[0].name
        : `${selected.length} sets`;

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-9 min-w-[160px] items-center justify-between gap-2 rounded-[12px] border bg-surface px-3 text-sm font-medium transition-colors",
          open ? "border-sage" : "border-black/[0.08] hover:border-black/20",
          selected.length ? "text-ink" : "text-ink-faint",
        )}
      >
        <span className="truncate">{summary}</span>
        <svg
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          className={cn("shrink-0 text-ink-faint transition-transform", open && "rotate-180")}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open &&
        rect &&
        createPortal(
          <ul
            ref={menuRef}
            className="anim-scale-in fixed z-[80] max-h-64 overflow-auto rounded-[14px] border border-black/[0.08] bg-surface p-1.5 shadow-[0_18px_44px_rgba(46,42,38,0.18)]"
            style={{ left: rect.left, top: rect.bottom + 6, minWidth: Math.max(rect.width, 200) }}
          >
            {options.map((o) => {
              const on = value.includes(o.id);
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => toggle(o.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-sm transition-colors",
                      on ? "text-sage-deep" : "text-ink hover:bg-black/[0.03]",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border text-[11px] font-bold",
                        on ? "border-sage bg-sage text-white" : "border-black/15 bg-surface",
                      )}
                    >
                      {on ? "✓" : ""}
                    </span>
                    <span className="flex-1 truncate font-medium">{o.name}</span>
                    <span className="text-xs text-ink-faint">{o.count}</span>
                  </button>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}
