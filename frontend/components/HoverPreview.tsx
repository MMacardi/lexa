"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Eye, Pin } from "lucide-react";
import { cn } from "@/lib/utils";

// Reusable "hover to preview" shell: a small trigger button that reveals a popover
// on hover, and can be pinned (click) to keep it open while the learner keeps
// adjusting settings. Opens to the right on desktop (more room), below on mobile.
export function HoverPreview({ label, title, width = 264, children }: { label: string; title: string; width?: number; children: React.ReactNode }) {
  const { t } = useI18n();
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || pinned;

  return (
    <div className="relative mt-3 inline-block" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        type="button"
        onClick={() => setPinned((p) => !p)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors",
          open ? "border-sage/50 bg-sage-tint/50 text-sage-deep" : "border-black/[0.1] text-ink-muted hover:border-sage/50 hover:text-sage-deep",
        )}
      >
        <Eye className="h-3.5 w-3.5" /> {label}
      </button>

      {open && (
        <div
          className="anim-popover absolute left-0 top-full z-30 mt-2 rounded-[18px] border border-black/[0.08] bg-surface p-3 shadow-[0_20px_50px_rgba(46,42,38,0.2)] sm:left-full sm:top-0 sm:ml-3 sm:mt-0"
          style={{ width }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{title}</span>
            <button
              type="button"
              onClick={() => setPinned((p) => !p)}
              title={t("preview.pin")}
              className={cn("rounded-full p-1 transition-colors", pinned ? "bg-sage-tint text-sage-deep" : "text-ink-faint hover:text-ink")}
            >
              <Pin className="h-3.5 w-3.5" />
            </button>
          </div>
          {children}
        </div>
      )}
    </div>
  );
}
