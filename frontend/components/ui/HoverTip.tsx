"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// Small styled tooltip that matches the app (onyx bubble, title + optional
// subtitle). Portaled to <body> so it's never clipped by an overflow-hidden or
// transformed ancestor, and it works on touch (tap to show, tap-away to dismiss).
export function HoverTip({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const enabled = !!title;

  const show = () => {
    if (!enabled) return; // no title (e.g. a conditional hint that isn't active) → no tooltip
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: r.left + r.width / 2, y: r.top });
  };

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setPos(null);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onEsc);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onEsc);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [pos]);

  return (
    <span
      ref={ref}
      className={className}
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
      onPointerDown={(e) => {
        if (e.pointerType !== "mouse") show();
      }}
    >
      {children}
      {pos &&
        createPortal(
          <div
            className={cn(
              "pointer-events-none fixed z-[95] -translate-x-1/2 -translate-y-full rounded-[10px] bg-onyx px-2.5 py-1.5 text-center shadow-[0_10px_28px_rgba(0,0,0,0.28)]",
            )}
            style={{ left: pos.x, top: pos.y - 8 }}
          >
            <div className="text-[12px] font-semibold text-white">{title}</div>
            {subtitle && <div className="text-[10px] font-medium text-white/60">{subtitle}</div>}
          </div>,
          document.body,
        )}
    </span>
  );
}
