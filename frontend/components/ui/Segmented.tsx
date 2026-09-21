"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Measuring has to happen before the browser paints or the pill shows up a frame
// late; on the server there is nothing to measure.
const useMeasureEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// A row of mutually exclusive options. The selected pill is a single element
// that slides to whichever option you pick — the app used to give each button
// its own `bg-sage` and cross-fade the colour, so the selection teleported.
// Widths differ per option (and per language), so the pill is measured from the
// live DOM; globals.css owns the movement itself (`.seg-thumb`).

export interface SegOption<T extends string> {
  value: T;
  label: React.ReactNode;
  Icon?: React.ComponentType<{ className?: string }>;
  title?: string;
  disabled?: boolean;
}

const SIZES = {
  xs: { box: "gap-0.5 p-0.5 text-[11px]", item: "px-2.5 py-1", icon: "h-3 w-3" },
  sm: { box: "gap-0.5 p-0.5 text-[12px]", item: "px-3 py-1", icon: "h-3.5 w-3.5" },
  md: { box: "gap-1 p-1 text-[13px]", item: "px-3 py-1.5", icon: "h-3.5 w-3.5" },
  lg: { box: "gap-1 p-1 text-sm", item: "px-3.5 py-1.5", icon: "h-4 w-4" },
} as const;

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  tone = "track",
  grow,
  scroll,
  className,
  itemClassName,
  ariaLabel,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: keyof typeof SIZES;
  /** "track": a filled groove (the default). "outlined": a hairline on paper. */
  tone?: "track" | "outlined";
  /** Options share the row evenly instead of sizing to their label. */
  grow?: boolean;
  /** Phones: swipe the row sideways rather than wrapping it (see `.scroll-row`). */
  scroll?: boolean;
  className?: string;
  itemClassName?: string;
  ariaLabel?: string;
}) {
  const s = SIZES[size];
  const keys = options.map((o) => o.value).join("|");
  const box = useRef<HTMLDivElement>(null);
  const items = useRef(new Map<string, HTMLButtonElement>());
  const [thumb, setThumb] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // The first measurement must not animate, or the pill flies in from the corner.
  const [ready, setReady] = useState(false);

  useMeasureEffect(() => {
    const measure = () => {
      const el = items.current.get(value);
      const row = box.current;
      if (!el || !row) {
        setThumb(null);
        return;
      }
      // Measured against the container's padding box rather than offsetLeft, so
      // a positioned wrapper around an option (HoverTip) can't become the
      // offsetParent and throw the pill to the left edge. Adding the scroll
      // offset keeps it right in a sideways-scrolling row.
      const rb = row.getBoundingClientRect();
      const re = el.getBoundingClientRect();
      const next = {
        x: re.left - rb.left - row.clientLeft + row.scrollLeft,
        y: re.top - rb.top - row.clientTop + row.scrollTop,
        w: el.offsetWidth,
        h: el.offsetHeight,
      };
      // Same numbers must not produce a new object: the options array is usually
      // built inline by the caller, so this effect re-runs on every render.
      setThumb((p) => (p && p.x === next.x && p.y === next.y && p.w === next.w && p.h === next.h ? p : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    const active = items.current.get(value);
    if (active) ro.observe(active); // labels change width when the UI language does
    return () => ro.disconnect();
  }, [value, keys]);

  useEffect(() => {
    if (thumb && !ready) {
      const id = requestAnimationFrame(() => setReady(true));
      return () => cancelAnimationFrame(id);
    }
  }, [thumb, ready]);

  return (
    <div
      ref={box}
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "relative isolate flex rounded-full font-semibold",
        tone === "outlined" ? "border border-black/[0.07] bg-paper/60" : "bg-black/[0.05]",
        s.box,
        scroll && "scroll-row",
        className,
      )}
    >
      {thumb && (
        <span
          aria-hidden
          className={cn(
            "absolute left-0 top-0 -z-10 rounded-full bg-sage shadow-sm",
            ready && "seg-thumb",
          )}
          style={{
            width: thumb.w,
            height: thumb.h,
            transform: `translate3d(${thumb.x}px, ${thumb.y}px, 0)`,
          }}
        />
      )}
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              if (el) items.current.set(o.value, el);
              else items.current.delete(o.value);
            }}
            type="button"
            aria-pressed={on}
            title={o.title}
            disabled={o.disabled}
            onClick={() => !o.disabled && onChange(o.value)}
            className={cn(
              "relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full transition-colors duration-200",
              s.item,
              grow && "flex-1",
              on ? "text-white" : "text-ink-muted hover:text-ink",
              o.disabled && "opacity-40",
              itemClassName,
            )}
          >
            {o.Icon && <o.Icon className={s.icon} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
