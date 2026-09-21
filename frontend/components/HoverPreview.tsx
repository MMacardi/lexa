"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePresence } from "@/lib/motion";

// Reusable "preview" shell: a small trigger button that toggles a panel open/closed
// right under it, in the page flow — a floating popover got stuck open on touch
// (tap = hover with no leave) and spilled past the page edge on desktop.
export function HoverPreview({ label, title, width = 264, children }: { label: string; title: string; width?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const menu = usePresence(open);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors",
          open ? "border-sage/50 bg-sage-tint/50 text-sage-deep" : "border-black/[0.1] text-ink-muted hover:border-sage/50 hover:text-sage-deep",
        )}
      >
        <Eye className="h-3.5 w-3.5" /> {label}
      </button>

      {menu.mounted && (
        <div
          data-closing={menu.closing || undefined}
          className="anim-popover mt-2 w-full rounded-[18px] border border-black/[0.08] bg-surface p-3 shadow-[0_12px_30px_rgba(46,42,38,0.12)]"
          style={{ maxWidth: width + 40 }}
        >
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{title}</p>
          {children}
        </div>
      )}
    </div>
  );
}
