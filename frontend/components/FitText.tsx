"use client";

import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

// A big line of text whose font shrinks (from `max` down to `min` px) until its longest
// word fits the width it's given. It still wraps at spaces as usual; only a word too
// wide to wrap makes it shrink, and past `min` that word breaks instead of spilling out.
export function FitText({ text, max, min, className }: { text: string; max: number; min: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let live = true;
    const fit = () => {
      if (!live) return;
      // Measure at full size: whatever spills past the box is the one word that
      // can't wrap, and its width scales with the font size.
      el.style.overflowWrap = "";
      el.style.fontSize = `${max}px`;
      const { scrollWidth, clientWidth } = el;
      if (scrollWidth <= clientWidth) return;
      const size = Math.max(min, Math.floor((max * clientWidth) / scrollWidth));
      el.style.fontSize = `${size}px`;
      if (size === min) el.style.overflowWrap = "anywhere";
    };
    fit();
    // Refit when the box changes (rotation, the speak button mounting beside it) and
    // once the web font lands, since the fallback font measures differently.
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener("resize", fit);
    document.fonts?.ready.then(fit);
    return () => {
      live = false;
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [text, max, min]);

  return (
    <span ref={ref} className={cn("block min-w-0", className)} style={{ fontSize: max }}>
      {text}
    </span>
  );
}
