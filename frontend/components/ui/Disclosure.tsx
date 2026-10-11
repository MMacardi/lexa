"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { Collapse } from "@/components/ui/Collapse";
import { MobileSheet } from "@/components/MobileSheet";
import { useIsMobile, useLockScroll } from "@/lib/mobileNav";
import { usePresence } from "@/lib/motion";
import { cn } from "@/lib/utils";

// A tucked-away settings card: a summary row that opens a panel under it. It
// replaces <details>, whose open/close can't be animated in Safari — this one
// unfolds by height everywhere. Given a `sheet` title, a phone opens it as a
// bottom sheet instead: a setup page stays one screen that doesn't scroll, and
// the settings scroll inside the sheet when they're long (the author, 2026-10-10).
export function Disclosure({ summary, sheet, children }: { summary: React.ReactNode; sheet?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const mobile = useIsMobile();
  const asSheet = !!sheet && mobile;
  const presence = usePresence(asSheet && open, 200);
  useLockScroll(asSheet && open);
  return (
    <div className="rounded-[20px] border border-black/[0.06] bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left text-sm font-semibold text-ink-muted"
      >
        {summary}
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform duration-300", asSheet ? "-rotate-90" : open && "rotate-180")} />
      </button>
      {!asSheet && (
        <Collapse open={open}>
          <div className="border-t border-black/[0.06] px-5 pb-5 pt-4">{children}</div>
        </Collapse>
      )}
      {presence.mounted &&
        createPortal(
          <MobileSheet closing={presence.closing} onClose={() => setOpen(false)} title={sheet!}>
            <div className="px-1 pb-1">{children}</div>
          </MobileSheet>,
          document.body,
        )}
    </div>
  );
}
