"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LANGS } from "@/lib/langs";
import { cn } from "@/lib/utils";

// Pretty custom dropdown for picking a language. The menu is rendered in a
// portal (position: fixed) so it always floats above the page — no z-index /
// stacking-context bleed-through from neighbouring elements.
export function LangSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const current = LANGS.find((l) => l.code === value);

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

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-[14px] border bg-surface px-3.5 text-[15px] font-medium text-ink transition-colors",
          open ? "border-sage" : "border-black/[0.08] hover:border-black/20",
        )}
      >
        <span>{current?.native ?? value}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          className={cn("text-ink-faint transition-transform", open && "rotate-180")}
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
            style={{ left: rect.left, top: rect.bottom + 6, minWidth: Math.max(rect.width, 150) }}
          >
            {LANGS.map((l) => {
              const active = l.code === value;
              return (
                <li key={l.code}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(l.code);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-[15px] transition-colors",
                      active ? "bg-sage-tint font-semibold text-sage-deep" : "text-ink hover:bg-black/[0.03]",
                    )}
                  >
                    {l.native}
                    {active && <span className="text-sage">✓</span>}
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
