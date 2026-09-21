"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Collapse } from "@/components/ui/Collapse";
import { cn } from "@/lib/utils";

// A tucked-away settings card: a summary row that opens a panel under it. It
// replaces <details>, whose open/close can't be animated in Safari — this one
// unfolds by height everywhere.
export function Disclosure({ summary, children }: { summary: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[20px] border border-black/[0.06] bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left text-sm font-semibold text-ink-muted"
      >
        {summary}
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform duration-300", open && "rotate-180")} />
      </button>
      <Collapse open={open}>
        <div className="border-t border-black/[0.06] px-5 pb-5 pt-4">{children}</div>
      </Collapse>
    </div>
  );
}
