"use client";

import { ArrowDown } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// A messenger's way back down: shown once a chat is scrolled well back from its
// newest line (useChatScroll's `away`). Sits in the scroller's positioned parent,
// over the thread's bottom-right corner.
export function JumpToLatest({ show, onClick }: { show: boolean; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("mika.toLatest")}
      title={t("mika.toLatest")}
      tabIndex={show ? 0 : -1}
      aria-hidden={!show}
      className={cn(
        "absolute right-3 bottom-3 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-black/[0.08] bg-surface text-ink-muted shadow-[0_6px_18px_rgba(46,42,38,0.18)] transition-[opacity,translate] duration-200",
        show ? "opacity-100" : "pointer-events-none translate-y-2 opacity-0",
      )}
    >
      <ArrowDown className="h-[18px] w-[18px]" />
    </button>
  );
}
