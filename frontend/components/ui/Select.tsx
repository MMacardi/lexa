"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { usePresence } from "@/lib/motion";
import { useAnchor } from "@/lib/anchor";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string; // small secondary text (e.g. "upper-intermediate")
}

// Compact, app-styled single-select dropdown (portal-based, stays with its
// trigger on scroll instead of closing). A prettier replacement for a native <select>.
export function Select({
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
  className,
  menuMinWidth = 180,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  menuMinWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const menu = usePresence(open);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const anchor = useAnchor(open, triggerRef, menuRef);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-[12px] border bg-surface px-3 text-sm font-semibold transition-colors",
          open ? "border-sage text-ink" : "border-black/[0.08] text-ink-muted hover:border-black/20",
        )}
      >
        <span className="truncate">{current?.label ?? placeholder ?? value}</span>
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

      {menu.mounted &&
        anchor &&
        (() => {
          // Flip the menu above the trigger when there isn't enough room below,
          // and cap its height to the available space so it always scrolls.
          const { spaceAbove, spaceBelow } = anchor;
          const openUp = spaceBelow < 240 && spaceAbove > spaceBelow;
          const maxHeight = Math.max(140, Math.min(288, (openUp ? spaceAbove : spaceBelow) - 12));
          return createPortal(
            <div
              data-closing={menu.closing || undefined}
              ref={menuRef}
              className="anim-scale-in z-[220] flex flex-col overflow-hidden rounded-[14px] border border-black/[0.08] bg-surface shadow-[0_18px_44px_rgba(46,42,38,0.18)]"
              style={{
                position: anchor.position,
                left: anchor.left,
                minWidth: Math.max(anchor.width, menuMinWidth),
                maxHeight,
                // Opening up, the menu hangs from the trigger's top edge by its own height.
                ...(openUp ? { top: anchor.top - 6, translate: "0 -100%" } : { top: anchor.bottom + 6 }),
                ...(openUp ? ({ "--drop": "6px", "--drop-origin": "bottom" } as React.CSSProperties) : null),
              }}
            >
              <ul className="overflow-auto p-1.5">
              {options.map((o) => {
                const active = o.value === value;
                return (
                  <li key={o.value}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(o.value);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-left transition-colors",
                        active ? "bg-sage-tint text-sage-deep" : "text-ink hover:bg-black/[0.03]",
                      )}
                    >
                      <span className="flex flex-col">
                        <span className={cn("text-sm", active && "font-semibold")}>{o.label}</span>
                        {o.hint && <span className="text-[11px] text-ink-faint">{o.hint}</span>}
                      </span>
                      {active && <span className="text-sage">✓</span>}
                    </button>
                  </li>
                );
              })}
              </ul>
            </div>,
            document.body,
          );
        })()}
    </div>
  );
}
