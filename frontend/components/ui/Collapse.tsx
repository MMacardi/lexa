"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "@/lib/motion";

// A section that opens and closes by height instead of popping in. It stays
// mounted while closed (inert, so nothing inside can be tabbed to), which is
// what lets it animate both ways; the curve lives in globals.css (`.anim-collapse`).
export function Collapse({ open, className, children }: { open: boolean; className?: string; children: React.ReactNode }) {
  // Clipping is needed while the height moves, but once it's fully open a
  // focus ring or shadow at the edge shouldn't be cut off.
  const [settled, setSettled] = useState(open);
  useEffect(() => {
    // With reduced motion there is no transition, so no transitionend to wait for.
    setSettled(open && prefersReducedMotion() ? true : (s) => open && s);
  }, [open]);

  return (
    <div
      className="anim-collapse"
      data-open={open || undefined}
      data-settled={settled || undefined}
      inert={!open}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === "grid-template-rows" && open) setSettled(true);
      }}
    >
      <div className={cn(className)}>{children}</div>
    </div>
  );
}
