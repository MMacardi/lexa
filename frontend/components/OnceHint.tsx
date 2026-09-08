"use client";

import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// A soft, one-time helper line: it teaches one screen's mechanic, then gets out
// of the way for good. Dismissal is persisted per id, so it never nags again —
// the product deliberately avoids intrusive guided tours.
export function OnceHint({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const storageKey = `lexa.hint.${id}`;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(storageKey) === "1";
    } catch {
      seen = false; // storage unavailable — err toward showing the hint once
    }
    if (!seen) setVisible(true);
  }, [storageKey]);

  if (!visible) return null;

  function dismiss() {
    try {
      localStorage.setItem(storageKey, "1");
    } catch {
      /* ignore */
    }
    setVisible(false);
  }

  return (
    <div
      className={cn(
        "anim-fade-up flex items-start gap-2.5 rounded-2xl border border-sage/25 bg-sage-tint/40 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-soft",
        className,
      )}
    >
      <Sparkles className="mt-[1px] h-4 w-4 shrink-0 text-sage-deep" />
      <p className="flex-1">{children}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("hint.dismiss")}
        className="-mr-1 mt-[1px] shrink-0 rounded-full p-1 text-ink-faint transition-colors hover:bg-black/[0.04] hover:text-ink"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
